// Barreras contra pagos accidentales en mainnet (cadena falsa, sin red ni IA).
// En cada caso se verifica que no se firmó ni se difundió nada.
import test from "node:test";
import assert from "node:assert/strict";
import { createPayTool, MainnetGuardError, PaymentError } from "../lib/chain/payTool.ts";
import { analyzeRequest, authorize, autoAuthorize, submitExpense } from "../lib/workflow.ts";
import { addMember, updateMember } from "../lib/members.ts";
import { unsafeRecipientReason } from "../lib/policy.ts";
import * as repo from "../lib/repo.ts";
import type { Analyzer } from "../lib/agent/analyze.ts";
import { aiOut, makeCtx, COLLAB, ORG, RECIPIENT, tinyPng } from "./helpers.ts";
import { authorizedRequest, mainnetSetup } from "./payments-helpers.ts";

const OK = { verifiedAmountAndRecipient: true, reviewedAlerts: false, reason: "" };
const fakeAnalyzer: Analyzer = async () => ({ ok: true, output: aiOut({ extracted: { amount: "100.00" } }), model: "fake", provider: "fake", fake: true });

async function auditActions(db: Parameters<typeof repo.listAudit>[0], id: number) {
  return (await repo.listAudit(db, id)).map((a) => `${a.action}:${a.detail ?? ""}`);
}

test("AI_MODE=fake + mainnet: la herramienta de pago se niega antes de tocar la red", async () => {
  const { ctx, id } = await authorizedRequest();
  const { account, chain } = mainnetSetup(ctx.db);
  const pay = createPayTool({ db: ctx.db, mode: "mainnet", chain, account, aiMode: "fake", receiptTimeoutMs: 10 });
  await assert.rejects(pay(id), (e: unknown) => e instanceof MainnetGuardError && /prueba/.test(e.message));
  assert.equal(account.signCount, 0);
  assert.equal(chain.sentRaw.length, 0);
  assert.equal((await repo.listPayments(ctx.db, id)).length, 0);
  assert.ok((await auditActions(ctx.db, id)).some((a) => a.startsWith("payment_blocked") && a.includes("fake_ai_in_mainnet")));
});

test("una solicitud analizada con el analizador de prueba no se paga en mainnet aunque la app esté en modo real", async () => {
  const ctx = await makeCtx(fakeAnalyzer);
  const id = await submitExpense(ctx, COLLAB, { description: "x", recipient: RECIPIENT, file: { bytes: tinyPng(1), mime: "image/png" } });
  await analyzeRequest(ctx, id);
  await authorize(ctx, ORG, id, OK);
  const { account, chain } = mainnetSetup(ctx.db);
  const pay = createPayTool({ db: ctx.db, mode: "mainnet", chain, account, aiMode: "real", receiptTimeoutMs: 10 });
  await assert.rejects(pay(id), MainnetGuardError);
  assert.equal(account.signCount, 0);
  assert.equal(chain.sentRaw.length, 0);
  assert.equal((await repo.getRequest(ctx.db, id))!.status, "authorized");
});

test("pago automático: con análisis de prueba en mainnet no autoriza; en simulado sí", async () => {
  const mk = async (paymentMode: "mainnet" | "simulated") => {
    const ctx = { ...(await makeCtx(fakeAnalyzer)), paymentMode };
    const id = await submitExpense(ctx, COLLAB, { description: "x", recipient: RECIPIENT, file: { bytes: tinyPng(1), mime: "image/png" } });
    await analyzeRequest(ctx, id);
    return { ctx, id };
  };
  const main = await mk("mainnet");
  assert.equal(await autoAuthorize(main.ctx, main.id), null);
  assert.ok((await auditActions(main.ctx.db, main.id)).some((a) => a.startsWith("auto_pay_blocked") && a.includes("fake_ai_in_mainnet")));
  const sim = await mk("simulated");
  assert.ok(await autoAuthorize(sim.ctx, sim.id));
});

test("destinos que nadie controla se rechazan", () => {
  for (const bad of [
    "0x0000000000000000000000000000000000000000",
    "0x1111111111111111111111111111111111111111",
    "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "0x000000000000000000000000000000000000dEaD",
    "0xdead000000000000000000000000000000000000",
  ]) {
    assert.ok(unsafeRecipientReason(bad), bad);
  }
  assert.equal(unsafeRecipientReason(RECIPIENT), null);
});

test("el equipo no acepta una wallet de prueba ni de quemado", async () => {
  const ctx = await makeCtx();
  await assert.rejects(() => updateMember(ctx, ORG, 2, { wallet: "0x1111111111111111111111111111111111111111" }), /prueba/);
  await assert.rejects(
    () => addMember(ctx, ORG, { email: "z@x.com", name: "Zoe", role: "collaborator", wallet: "0x000000000000000000000000000000000000dEaD" }),
    /quemado/,
  );
});

/** Solicitud autorizada cuyo destinatario se reemplaza en la base (como si viniera de antes de esta barrera). */
async function authorizedTo(recipient: string) {
  const { ctx, id } = await authorizedRequest();
  await ctx.db.query("UPDATE requests SET recipient = $1 WHERE id = $2", [recipient, id]);
  await ctx.db.query("UPDATE authorizations SET recipient = $1 WHERE request_id = $2", [recipient, id]);
  return { ctx, id };
}

for (const [label, recipient] of [
  ["dirección cero", "0x0000000000000000000000000000000000000000"],
  ["dígito repetido", "0x1111111111111111111111111111111111111111"],
  ["quemado 0x…dEaD", "0x000000000000000000000000000000000000dEaD"],
] as const) {
  test(`la herramienta de pago no firma hacia ${label}, ni en mainnet ni en simulado`, async () => {
    const { ctx, id } = await authorizedTo(recipient);
    const { account, chain, pay } = mainnetSetup(ctx.db);
    await assert.rejects(pay(id), PaymentError);
    assert.equal(account.signCount, 0);
    assert.equal(chain.sentRaw.length, 0);
    await assert.rejects(createPayTool({ db: ctx.db, mode: "simulated" })(id), PaymentError);
    assert.equal((await repo.listPayments(ctx.db, id)).length, 0);
    assert.ok((await auditActions(ctx.db, id)).some((a) => a.startsWith("payment_blocked") && a.includes("unsafe_recipient")));
  });
}

test("la herramienta de pago no le paga a la propia wallet del agente", async () => {
  const { ctx, id } = await authorizedRequest();
  const { account, chain, pay } = mainnetSetup(ctx.db);
  await ctx.db.query("UPDATE requests SET recipient = $1 WHERE id = $2", [account.address, id]);
  await ctx.db.query("UPDATE authorizations SET recipient = $1 WHERE request_id = $2", [account.address, id]);
  await assert.rejects(pay(id), /propio agente/);
  assert.equal(account.signCount, 0);
  assert.equal(chain.sentRaw.length, 0);
});
