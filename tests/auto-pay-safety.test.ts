// Salvaguardas del pago automático: si un humano intervino decide él, y hay un tope de 24 h.
import test from "node:test";
import assert from "node:assert/strict";
import { AuthError } from "../lib/auth.ts";
import {
  analyzeRequest,
  autoAuthorize,
  correctFields,
  requestClarification,
  respondClarification,
  setAutoPayDailyCap,
  submitExpense,
  WorkflowError,
} from "../lib/workflow.ts";
import { maybeAutoPay } from "../lib/autopay.ts";
import { createPayTool } from "../lib/chain/payTool.ts";
import * as repo from "../lib/repo.ts";
import { aiOut, makeCtx, scriptedAnalyzer, setAutoPayMax, COLLAB, ORG, RECIPIENT, tinyPng, type TestCtx } from "./helpers.ts";

/** Cada descripción "<monto> <comercio>" produce un ticket distinto (para que no sean duplicados entre sí). */
async function ctxTickets() {
  return await makeCtx(
    scriptedAnalyzer((d) => {
      const [amount, ...rest] = d.split(" ");
      return aiOut({ extracted: { amount, merchant: `Remis ${rest.join(" ")}` } });
    }),
  );
}
let seed = 1000;
async function analyzed(ctx: TestCtx, description: string) {
  const id = await submitExpense(ctx, COLLAB, { description, recipient: RECIPIENT, file: { bytes: tinyPng(seed++), mime: "image/png" } });
  await analyzeRequest(ctx, id);
  return id;
}
const simulated = (ctx: TestCtx) => createPayTool({ db: ctx.db, mode: "simulated", account: null });

test("si el organizador pidió aclaración, la respuesta del colaborador vuelve a él: no se paga sola", async () => {
  const ctx = await ctxTickets();
  await setAutoPayMax(ctx.db, 0); // apagado al llegar: el organizador lo revisa a mano
  const id = await analyzed(ctx, "100.00 a");
  await requestClarification(ctx, ORG, id, "¿Quién viajó y desde dónde?");
  await setAutoPayMax(ctx.db, 10000); // después se enciende el automático
  await respondClarification(ctx, COLLAB, id, "Yo, desde casa al venue");
  await analyzeRequest(ctx, id);
  assert.equal((await repo.getRequest(ctx.db, id))!.recommendation, "approve");
  assert.equal(await maybeAutoPay(ctx, id, simulated(ctx)), null);
  assert.equal((await repo.getRequest(ctx.db, id))!.status, "analyzed");
  assert.equal((await repo.listAuthorizations(ctx.db, id)).length, 0);
});

test("si el organizador corrigió los datos, no se paga solo", async () => {
  const ctx = await ctxTickets();
  await setAutoPayMax(ctx.db, 0);
  const id = await analyzed(ctx, "150.00 b");
  await correctFields(ctx, ORG, id, { date: "2026-10-15", merchant: "Remis b", concept: "viaje", amount: "100.00", currency: "ARS", category: "transporte" });
  await setAutoPayMax(ctx.db, 10000);
  assert.equal(await autoAuthorize(ctx, id), null);
});

test("tope de 24 h por defecto: 3 veces el límite. El 4.º gasto de $ 100 espera al organizador", async () => {
  const ctx = await ctxTickets();
  assert.deepEqual(await repo.dailyCapFor(ctx.db, 10000), { cents: 30000, custom: false });
  const ids = [];
  for (const m of ["c", "d", "e", "f"]) ids.push(await analyzed(ctx, `100.00 ${m}`));
  const results = [];
  for (const id of ids) results.push((await maybeAutoPay(ctx, id, simulated(ctx)))?.status ?? "al organizador");
  assert.deepEqual(results, ["confirmed", "confirmed", "confirmed", "al organizador"]);
  assert.equal((await repo.getRequest(ctx.db, ids[3]))!.status, "analyzed");
  assert.ok((await repo.listAudit(ctx.db, ids[3])).some((a) => a.action === "auto_pay_skipped" && a.detail?.includes("daily_cap")));
});

test("pasadas 24 h, el tope se libera", async () => {
  const ctx = await ctxTickets();
  const ids = [];
  for (const m of ["g", "h", "i", "j"]) ids.push(await analyzed(ctx, `100.00 ${m}`));
  for (const id of ids.slice(0, 3)) assert.ok(await autoAuthorize(ctx, id));
  assert.equal(await autoAuthorize(ctx, ids[3]), null);
  assert.ok(await autoAuthorize(ctx, ids[3], Date.now() + 25 * 3600 * 1000));
});

test("las autorizaciones revocadas (pago fallido) no consumen el tope", async () => {
  const ctx = await ctxTickets();
  const ids = [];
  for (const m of ["k", "l", "m", "n"]) ids.push(await analyzed(ctx, `100.00 ${m}`));
  for (const id of ids.slice(0, 3)) {
    const authId = (await autoAuthorize(ctx, id))!;
    await repo.revokeAuthorization(ctx.db, authId, "pago fallido");
  }
  assert.ok(await autoAuthorize(ctx, ids[3]));
});

test("el organizador fija el tope diario (o vuelve al automático); el colaborador no puede", async () => {
  const ctx = await ctxTickets();
  await assert.rejects(() => setAutoPayDailyCap(ctx, COLLAB, 0), (e: unknown) => e instanceof AuthError && e.code === "forbidden");
  await assert.rejects(() => setAutoPayDailyCap(ctx, ORG, -1), WorkflowError);
  await setAutoPayDailyCap(ctx, ORG, 15000);
  assert.deepEqual(await repo.dailyCapFor(ctx.db, 10000), { cents: 15000, custom: true });
  const a = await analyzed(ctx, "100.00 o");
  const b = await analyzed(ctx, "100.00 p");
  assert.ok(await autoAuthorize(ctx, a));
  assert.equal(await autoAuthorize(ctx, b), null);
  await setAutoPayDailyCap(ctx, ORG, null);
  assert.deepEqual(await repo.dailyCapFor(ctx.db, 10000), { cents: 30000, custom: false });
  const [log] = await ctx.db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM audit_log WHERE action = 'auto_pay_daily_cap_updated'");
  assert.equal(log.n, 2);
});

test("la vista previa le avisa al colaborador si el agente se lo pagaría solo", async () => {
  const { previewExpense } = await import("../lib/workflow.ts");
  const hint = async (amount: string) => {
    const ctx = await makeCtx(scriptedAnalyzer(() => aiOut({ extracted: { amount } })));
    const r = await previewExpense(ctx, COLLAB, { bytes: tinyPng(seed++) });
    return r.ok ? r.autoPay : "error";
  };
  assert.match((await hint("100.00"))!, /te lo paga solo/);
  assert.match((await hint("150.00"))!, /lo aprueba el organizador/);
});
