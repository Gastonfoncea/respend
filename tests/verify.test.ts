import test from "node:test";
import assert from "node:assert/strict";
import { getAddress } from "viem";
import { reconcile } from "../lib/chain/reconcile.ts";
import * as repo from "../lib/repo.ts";
import { authorizedRequest, mainnetSetup } from "./payments-helpers.ts";

for (const [name, tamper] of [
  ["monto distinto", (l: { to: `0x${string}`; value: bigint }) => ({ ...l, value: l.value - 1n })],
  ["destinatario distinto", (l: { to: `0x${string}`; value: bigint }) => ({ ...l, to: getAddress("0x2222222222222222222222222222222222222222") })],
] as const) {
  test(`verify: Transfer con ${name} → no confirma`, async () => {
    const { ctx, id } = await authorizedRequest();
    const { chain, pay } = mainnetSetup(ctx.db);
    chain.tamperLog = tamper;
    const res = await pay(id);
    assert.notEqual(res.status, "confirmed");
    assert.equal(repo.getRequest(ctx.db, id)!.status, "payment_uncertain");
    assert.match(repo.getPayment(ctx.db, res.paymentId)!.error!, /no coincide/);
    // Reconciliar no lo "arregla".
    assert.notEqual((await reconcile(ctx.db, chain, res.paymentId)).status, "confirmed");
  });
}

test("verify: Transfer correcto → confirmed con tag", async () => {
  const { ctx, id } = await authorizedRequest();
  const { pay } = mainnetSetup(ctx.db);
  const res = await pay(id);
  assert.equal(res.status, "confirmed");
  assert.equal(repo.getPayment(ctx.db, res.paymentId)!.attribution_ok, 1);
});
