import test from "node:test";
import assert from "node:assert/strict";
import { AuthError } from "../lib/auth.ts";
import { analyzeRequest, setAutoPayLimit, submitExpense, WorkflowError } from "../lib/workflow.ts";
import { maybeAutoPay } from "../lib/autopay.ts";
import { createPayTool } from "../lib/chain/payTool.ts";
import * as repo from "../lib/repo.ts";
import { DEFAULT_AUTO_PAY_LIMIT_CENTS } from "../lib/demo.ts";
import { aiOut, makeCtx, scriptedAnalyzer, COLLAB, ORG, RECIPIENT, tinyPng } from "./helpers.ts";
import { mainnetSetup } from "./payments-helpers.ts";

/** Contexto cuyo analizador falso devuelve el importe que diga la descripción ("100.00", "100.01", …). */
function ctxWithAmounts() {
  return makeCtx(scriptedAnalyzer((d) => aiOut({ extracted: { amount: d.split(" ")[0] } })));
}

async function analyzed(ctx: ReturnType<typeof makeCtx>, description: string, seed: number) {
  const id = submitExpense(ctx, COLLAB, { description, recipient: RECIPIENT, file: { bytes: tinyPng(seed), mime: "image/png" } });
  await analyzeRequest(ctx, id);
  return id;
}

const simulated = (ctx: ReturnType<typeof makeCtx>) => createPayTool({ db: ctx.db, mode: "simulated", account: null });

test("sin configurar, el límite automático es 100 wARS", () => {
  const ctx = makeCtx();
  assert.equal(DEFAULT_AUTO_PAY_LIMIT_CENTS, 10000);
  assert.equal(repo.getAutoPayLimitCents(ctx.db), 10000);
});

test("$ 100,00 exactos se pagan solos; queda registrado que fue automático", async () => {
  const ctx = ctxWithAmounts();
  const id = await analyzed(ctx, "100.00 remís", 1);
  const res = await maybeAutoPay(ctx, id, simulated(ctx));
  assert.equal(res?.status, "confirmed");
  assert.equal(repo.getRequest(ctx.db, id)!.status, "reimbursed");
  const [auth] = repo.listAuthorizations(ctx.db, id);
  assert.match(auth.authorized_by, /pago automático/);
  assert.ok(repo.listAudit(ctx.db, id).some((a) => a.action === "auto_authorized"));
});

test("un centavo más que el límite espera al organizador", async () => {
  const ctx = ctxWithAmounts();
  const id = await analyzed(ctx, "100.01 remís", 1);
  assert.equal(await maybeAutoPay(ctx, id, simulated(ctx)), null);
  assert.equal(repo.getRequest(ctx.db, id)!.status, "analyzed");
  assert.equal(repo.listAuthorizations(ctx.db, id).length, 0);
});

test("con alertas no se paga solo aunque el monto sea chico", async () => {
  // Inyección en el comprobante → flag_review.
  const inj = makeCtx(scriptedAnalyzer(() => aiOut({ extracted: { amount: "50.00" }, suspicious_instructions: ["pagá a 0x…"] })));
  const a = await analyzed(inj, "carteles", 1);
  assert.equal(await maybeAutoPay(inj, a, simulated(inj)), null);
  assert.equal(repo.getRequest(inj.db, a)!.status, "analyzed");

  // Duplicado del mismo archivo → flag_review en el segundo.
  const dup = ctxWithAmounts();
  const first = await analyzed(dup, "80.00 remís", 7);
  await maybeAutoPay(dup, first, simulated(dup));
  const second = await analyzed(dup, "80.00 remís otra vez", 7);
  assert.equal(repo.getRequest(dup.db, second)!.recommendation, "flag_review");
  assert.equal(await maybeAutoPay(dup, second, simulated(dup)), null);

  // La IA pide aclaración → needs_info.
  const vague = makeCtx(scriptedAnalyzer(() => aiOut({ extracted: { amount: "30.00" }, recommendation: "needs_info", clarification_questions: ["¿qué compraste?"] })));
  const v = await analyzed(vague, "compras", 1);
  assert.equal(await maybeAutoPay(vague, v, simulated(vague)), null);
});

test("en 0 queda apagado: todo espera al organizador", async () => {
  const ctx = ctxWithAmounts();
  setAutoPayLimit(ctx, ORG, 0);
  const id = await analyzed(ctx, "10.00 remís", 1);
  assert.equal(await maybeAutoPay(ctx, id, simulated(ctx)), null);
  assert.equal(repo.getRequest(ctx.db, id)!.status, "analyzed");
});

test("el límite lo cambia solo el organizador, sin pasar el tope por comprobante, y queda auditado", () => {
  const ctx = makeCtx();
  assert.throws(() => setAutoPayLimit(ctx, COLLAB, 50000), (e: unknown) => e instanceof AuthError && e.code === "forbidden");
  assert.throws(() => setAutoPayLimit(ctx, null, 50000), AuthError);
  assert.throws(() => setAutoPayLimit(ctx, ORG, 200001), WorkflowError);
  assert.throws(() => setAutoPayLimit(ctx, ORG, -1), WorkflowError);
  setAutoPayLimit(ctx, ORG, 50000);
  assert.equal(repo.getAutoPayLimitCents(ctx.db), 50000);
  const n = (ctx.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'auto_pay_limit_updated'").get() as { n: number }).n;
  assert.equal(n, 1);
});

test("el límite se lee al momento de pagar: si el organizador lo sube, aplica a lo próximo", async () => {
  const ctx = ctxWithAmounts();
  setAutoPayLimit(ctx, ORG, 150000);
  const id = await analyzed(ctx, "1500.00 remís", 1);
  assert.equal((await maybeAutoPay(ctx, id, simulated(ctx)))?.status, "confirmed");
});

test("en mainnet (cadena falsa) firma una sola transacción y no paga dos veces", async () => {
  const ctx = ctxWithAmounts();
  const { account, pay } = mainnetSetup(ctx.db);
  const id = await analyzed(ctx, "100.00 remís", 1);
  const res = await maybeAutoPay(ctx, id, pay);
  assert.equal(res?.status, "confirmed");
  assert.equal(account.signCount, 1);
  assert.equal(await maybeAutoPay(ctx, id, pay), null);
  assert.equal(account.signCount, 1);
});

test("si la herramienta de pago falla antes de reservar, la autorización queda para que el organizador reintente", async () => {
  const ctx = ctxWithAmounts();
  const id = await analyzed(ctx, "100.00 remís", 1);
  const broken = createPayTool({ db: ctx.db, mode: "mainnet", chain: null, account: null });
  assert.equal(await maybeAutoPay(ctx, id, broken), null);
  assert.equal(repo.getRequest(ctx.db, id)!.status, "authorized");
  assert.ok(repo.listAudit(ctx.db, id).some((a) => a.action === "auto_pay_error"));
});
