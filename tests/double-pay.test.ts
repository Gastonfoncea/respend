import test from "node:test";
import assert from "node:assert/strict";
import { createPayTool, payAsOrganizer } from "../lib/chain/payTool.ts";
import { reconcile } from "../lib/chain/reconcile.ts";
import { AuthError } from "../lib/auth.ts";
import * as repo from "../lib/repo.ts";
import { COLLAB, reopen } from "./helpers.ts";
import { authorizedRequest, mainnetSetup } from "./payments-helpers.ts";

test("dos payTool concurrentes sobre la misma solicitud → exactamente un pago (simulado)", async () => {
  const { ctx, id } = await authorizedRequest();
  const pay = createPayTool({ db: ctx.db, mode: "simulated" });
  const results = await Promise.allSettled([pay(id), pay(id), pay(id)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await repo.listPayments(ctx.db, id)).length, 1);
});

test("dos payTool concurrentes con conexiones distintas a la DB → un solo pago (mainnet, cadena falsa)", async () => {
  const { ctx, id } = await authorizedRequest();
  const db2 = reopen(ctx);
  const a = mainnetSetup(ctx.db);
  const pay2 = createPayTool({ db: db2, mode: "mainnet", chain: a.chain, account: a.account, receiptTimeoutMs: 10 });
  const results = await Promise.allSettled([a.pay(id), pay2(id)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await repo.listPayments(ctx.db, id)).length, 1);
  assert.equal(a.account.signCount, 1);
  assert.equal(a.chain.sentRaw.length, 1);
  assert.equal((await repo.getRequest(ctx.db, id))!.status, "reimbursed");
});

test("payTool sobre una solicitud ya reembolsada → error", async () => {
  const { ctx, id } = await authorizedRequest();
  const pay = createPayTool({ db: ctx.db, mode: "simulated" });
  await pay(id);
  await assert.rejects(pay(id), /reimbursed/);
  assert.equal((await repo.listPayments(ctx.db, id)).length, 1);
});

test("reinicio con un pago en 'signed' → payTool se niega y reconcile lo resuelve", async () => {
  const { ctx, id } = await authorizedRequest();
  const { chain, pay, account } = mainnetSetup(ctx.db);
  chain.sendBehavior = "hang"; // el proceso "muere" justo después de persistir signed
  void pay(id);
  await new Promise((r) => setTimeout(r, 50));
  const p0 = (await repo.listPayments(ctx.db, id))[0];
  assert.equal(p0.status, "signed");
  assert.ok(p0.raw_tx && p0.tx_hash);

  // "Reinicio": nueva conexión a la misma DB, nueva instancia de la herramienta.
  const db2 = reopen(ctx);
  chain.sendBehavior = "ok";
  const pay2 = createPayTool({ db: db2, mode: "mainnet", chain, account, receiptTimeoutMs: 10 });
  await assert.rejects(pay2(id), /paying/);
  assert.equal(account.signCount, 1);

  const r1 = await reconcile(db2, chain, p0.id);
  assert.equal(r1.status, "sent"); // re-difundió el mismo raw_tx
  assert.equal(chain.sentRaw.at(-1), p0.raw_tx);
  const r2 = await reconcile(db2, chain, p0.id);
  assert.equal(r2.status, "confirmed");
  assert.equal((await repo.getRequest(db2, id))!.status, "reimbursed");
  assert.equal(account.signCount, 1);
});

test("el colaborador no puede disparar el pago", async () => {
  const { ctx, id } = await authorizedRequest();
  const pay = createPayTool({ db: ctx.db, mode: "simulated" });
  await assert.rejects(payAsOrganizer(COLLAB, id, pay, ctx.db), AuthError);
  assert.equal((await repo.listPayments(ctx.db, id)).length, 0);
});

test("lock global: no se puede pagar otra solicitud mientras hay un pago vivo", async () => {
  const { ctx, id } = await authorizedRequest(1);
  const { chain, pay } = mainnetSetup(ctx.db);
  chain.sendBehavior = "network_error";
  assert.equal((await pay(id)).status, "uncertain");
  // Segunda solicitud autorizada en la misma DB.
  const { submitExpense, analyzeRequest, authorize } = await import("../lib/workflow.ts");
  const { COLLAB: C, ORG, RECIPIENT, tinyPng, scriptedAnalyzer, aiOut } = await import("./helpers.ts");
  const ctx2 = { ...ctx, analyzer: scriptedAnalyzer(() => aiOut({ extracted: { amount: "100.00", merchant: "Otro" } })) };
  const id2 = await submitExpense(ctx2, C, { description: "otro", recipient: RECIPIENT, file: { bytes: tinyPng(77), mime: "image/png" } });
  await analyzeRequest(ctx2, id2);
  await authorize(ctx2, ORG, id2, { verifiedAmountAndRecipient: true, reviewedAlerts: false, reason: "" });
  chain.sendBehavior = "ok";
  await assert.rejects(pay(id2), /otro pago en curso/);
});
