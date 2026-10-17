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
import { openDb } from "../lib/db.ts";
import * as repo from "../lib/repo.ts";
import { aiOut, makeCtx, scriptedAnalyzer, COLLAB, ORG, RECIPIENT, tinyPng } from "./helpers.ts";

/** Cada descripción "<monto> <comercio>" produce un ticket distinto (para que no sean duplicados entre sí). */
function ctxTickets() {
  return makeCtx(
    scriptedAnalyzer((d) => {
      const [amount, ...rest] = d.split(" ");
      return aiOut({ extracted: { amount, merchant: `Remis ${rest.join(" ")}` } });
    }),
  );
}
let seed = 1000;
async function analyzed(ctx: ReturnType<typeof makeCtx>, description: string) {
  const id = submitExpense(ctx, COLLAB, { description, recipient: RECIPIENT, file: { bytes: tinyPng(seed++), mime: "image/png" } });
  await analyzeRequest(ctx, id);
  return id;
}
const simulated = (ctx: ReturnType<typeof makeCtx>) => createPayTool({ db: ctx.db, mode: "simulated", account: null });

test("si el organizador pidió aclaración, la respuesta del colaborador vuelve a él: no se paga sola", async () => {
  const ctx = ctxTickets();
  repo.setAutoPayLimitCents(ctx.db, 0); // apagado al llegar: el organizador lo revisa a mano
  const id = await analyzed(ctx, "100.00 a");
  requestClarification(ctx, ORG, id, "¿Quién viajó y desde dónde?");
  repo.setAutoPayLimitCents(ctx.db, 10000); // después se enciende el automático
  respondClarification(ctx, COLLAB, id, "Yo, desde casa al venue");
  await analyzeRequest(ctx, id);
  assert.equal(repo.getRequest(ctx.db, id)!.recommendation, "approve");
  assert.equal(await maybeAutoPay(ctx, id, simulated(ctx)), null);
  assert.equal(repo.getRequest(ctx.db, id)!.status, "analyzed");
  assert.equal(repo.listAuthorizations(ctx.db, id).length, 0);
});

test("si el organizador corrigió los datos, no se paga solo", async () => {
  const ctx = ctxTickets();
  repo.setAutoPayLimitCents(ctx.db, 0);
  const id = await analyzed(ctx, "150.00 b");
  correctFields(ctx, ORG, id, { date: "2026-10-15", merchant: "Remis b", concept: "viaje", amount: "100.00", currency: "ARS", category: "transporte" });
  repo.setAutoPayLimitCents(ctx.db, 10000);
  assert.equal(autoAuthorize(ctx, id), null);
});

test("tope de 24 h por defecto: 3 veces el límite. El 4.º gasto de $ 100 espera al organizador", async () => {
  const ctx = ctxTickets();
  assert.deepEqual(repo.getAutoPayDailyCap(ctx.db), { cents: 30000, custom: false });
  const ids = [];
  for (const m of ["c", "d", "e", "f"]) ids.push(await analyzed(ctx, `100.00 ${m}`));
  const results = [];
  for (const id of ids) results.push((await maybeAutoPay(ctx, id, simulated(ctx)))?.status ?? "al organizador");
  assert.deepEqual(results, ["confirmed", "confirmed", "confirmed", "al organizador"]);
  assert.equal(repo.getRequest(ctx.db, ids[3])!.status, "analyzed");
  assert.ok(repo.listAudit(ctx.db, ids[3]).some((a) => a.action === "auto_pay_daily_cap_reached"));
});

test("pasadas 24 h, el tope se libera", async () => {
  const ctx = ctxTickets();
  const ids = [];
  for (const m of ["g", "h", "i", "j"]) ids.push(await analyzed(ctx, `100.00 ${m}`));
  for (const id of ids.slice(0, 3)) assert.ok(autoAuthorize(ctx, id));
  assert.equal(autoAuthorize(ctx, ids[3]), null);
  assert.ok(autoAuthorize(ctx, ids[3], Date.now() + 25 * 3600 * 1000));
});

test("las autorizaciones revocadas (pago fallido) no consumen el tope", async () => {
  const ctx = ctxTickets();
  const ids = [];
  for (const m of ["k", "l", "m", "n"]) ids.push(await analyzed(ctx, `100.00 ${m}`));
  for (const id of ids.slice(0, 3)) {
    const authId = autoAuthorize(ctx, id)!;
    repo.revokeAuthorization(ctx.db, authId, "pago fallido");
  }
  assert.ok(autoAuthorize(ctx, ids[3]));
});

test("el organizador fija el tope diario (o vuelve al automático); el colaborador no puede", async () => {
  const ctx = ctxTickets();
  assert.throws(() => setAutoPayDailyCap(ctx, COLLAB, 0), (e: unknown) => e instanceof AuthError && e.code === "forbidden");
  assert.throws(() => setAutoPayDailyCap(ctx, ORG, -1), WorkflowError);
  setAutoPayDailyCap(ctx, ORG, 15000);
  assert.deepEqual(repo.getAutoPayDailyCap(ctx.db), { cents: 15000, custom: true });
  const a = await analyzed(ctx, "100.00 o");
  const b = await analyzed(ctx, "100.00 p");
  assert.ok(autoAuthorize(ctx, a));
  assert.equal(autoAuthorize(ctx, b), null);
  setAutoPayDailyCap(ctx, ORG, null);
  assert.deepEqual(repo.getAutoPayDailyCap(ctx.db), { cents: 30000, custom: false });
  const log = ctx.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'auto_pay_daily_cap_updated'").get() as { n: number };
  assert.equal(log.n, 2);
});

test("migración: una base con agent_settings vieja suma la columna del tope sin perder el límite", () => {
  const ctx = makeCtx();
  ctx.db.exec("DROP TABLE agent_settings");
  ctx.db.exec("CREATE TABLE agent_settings (id INTEGER PRIMARY KEY CHECK (id = 1), auto_pay_limit_cents INTEGER NOT NULL, updated_at TEXT NOT NULL)");
  ctx.db.exec("INSERT INTO agent_settings VALUES (1, 5000, '2026-10-17')");
  ctx.db.close();
  const db = openDb(ctx.dbPath);
  assert.equal(repo.getAutoPayLimitCents(db), 5000);
  assert.deepEqual(repo.getAutoPayDailyCap(db), { cents: 15000, custom: false });
  db.close();
});

test("la vista previa le avisa al colaborador si el agente se lo pagaría solo", async () => {
  const { previewExpense } = await import("../lib/workflow.ts");
  const hint = async (amount: string) => {
    const ctx = makeCtx(scriptedAnalyzer(() => aiOut({ extracted: { amount } })));
    const r = await previewExpense(ctx, COLLAB, { bytes: tinyPng(seed++) });
    return r.ok ? r.autoPay : "error";
  };
  assert.match((await hint("100.00"))!, /te lo paga solo/);
  assert.match((await hint("150.00"))!, /lo aprueba el organizador/);
});
