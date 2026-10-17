import test from "node:test";
import assert from "node:assert/strict";
import { reconcile } from "../lib/chain/reconcile.ts";
import * as repo from "../lib/repo.ts";
import { getBudget } from "../lib/budget.ts";
import { authorizedRequest, mainnetSetup } from "./payments-helpers.ts";

test("(a) hay receipt de éxito → confirmed", async () => {
  const { ctx, id } = await authorizedRequest();
  const { chain, pay } = mainnetSetup(ctx.db);
  chain.autoMine = false;
  const res = await pay(id);
  assert.equal(res.status, "uncertain"); // no llegó el receipt a tiempo
  chain.mineAll();
  const r = await reconcile(ctx.db, chain, res.paymentId);
  assert.equal(r.status, "confirmed");
  const p = repo.getPayment(ctx.db, res.paymentId)!;
  assert.equal(p.attribution_ok, 1);
  assert.ok(p.block_number);
  assert.equal(repo.getRequest(ctx.db, id)!.status, "reimbursed");
});

test("(b) receipt reverted → failed, requiere nueva autorización", async () => {
  const { ctx, id } = await authorizedRequest();
  const { chain, pay } = mainnetSetup(ctx.db);
  chain.autoMine = false;
  const res = await pay(id);
  chain.revertNext = true;
  chain.mineAll();
  const r = await reconcile(ctx.db, chain, res.paymentId);
  assert.equal(r.status, "failed");
  assert.equal(repo.getRequest(ctx.db, id)!.status, "payment_failed");
  assert.equal(repo.getActiveAuthorization(ctx.db, id), null);
  assert.equal(getBudget(ctx.db).committedCents, 0);
});

test("(c) no se encuentra y el nonce está consumido → failed", async () => {
  const { ctx, id } = await authorizedRequest();
  const { chain, pay } = mainnetSetup(ctx.db);
  chain.sendBehavior = "drop";
  const res = await pay(id);
  assert.equal(res.status, "uncertain");
  chain.consumeNonceExternally();
  const r = await reconcile(ctx.db, chain, res.paymentId);
  assert.equal(r.status, "failed");
  assert.match(repo.getPayment(ctx.db, res.paymentId)!.error!, /nonce/);
});

test("(d) no se encuentra y el nonce está libre → re-difunde el MISMO raw_tx sin firmar nada nuevo", async () => {
  const { ctx, id } = await authorizedRequest();
  const { chain, pay, account } = mainnetSetup(ctx.db);
  chain.sendBehavior = "drop";
  const res = await pay(id);
  const before = repo.getPayment(ctx.db, res.paymentId)!;
  assert.equal(account.signCount, 1);
  chain.sendBehavior = "ok";
  const r = await reconcile(ctx.db, chain, res.paymentId);
  assert.equal(r.status, "sent");
  assert.equal(account.signCount, 1);
  assert.equal(chain.sentRaw.at(-1), before.raw_tx);
  const after = repo.getPayment(ctx.db, res.paymentId)!;
  assert.equal(after.tx_hash, before.tx_hash);
  assert.equal(after.nonce, before.nonce);
  assert.equal((await reconcile(ctx.db, chain, res.paymentId)).status, "confirmed");
});

test("(e) error de red al difundir → uncertain, nunca failed", async () => {
  const { ctx, id } = await authorizedRequest();
  const { chain, pay } = mainnetSetup(ctx.db);
  chain.sendBehavior = "network_error";
  const res = await pay(id);
  assert.equal(res.status, "uncertain");
  const p = repo.getPayment(ctx.db, res.paymentId)!;
  assert.equal(p.status, "uncertain");
  assert.ok(p.raw_tx);
  assert.equal(repo.getRequest(ctx.db, id)!.status, "payment_uncertain");
  // Sigue comprometido en el presupuesto.
  assert.equal(getBudget(ctx.db).committedCents, 150000);
  // Reconciliar con la red caída tampoco lo marca como fallido.
  const r = await reconcile(ctx.db, { ...chain, getReceipt: async () => { throw new Error("ECONNRESET"); } } as never, res.paymentId);
  assert.equal(r.status, "uncertain");
});
