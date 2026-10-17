import test from "node:test";
import assert from "node:assert/strict";
import { MainnetGuardError, PaymentError, createPayTool } from "../lib/chain/payTool.ts";
import * as repo from "../lib/repo.ts";
import { authorizedRequest, mainnetSetup } from "./payments-helpers.ts";

for (const [name, mutate] of [
  ["chainId distinto", (c: ReturnType<typeof mainnetSetup>["chain"]) => { c.chainId = 44787; }],
  ["decimales distintos", (c: ReturnType<typeof mainnetSetup>["chain"]) => { c.tokenMeta = { ...c.tokenMeta, decimals: 6 }; }],
  ["símbolo distinto", (c: ReturnType<typeof mainnetSetup>["chain"]) => { c.tokenMeta = { ...c.tokenMeta, symbol: "USDT" }; }],
] as const) {
  test(`mainnet guard: ${name} → aborta antes de firmar`, async () => {
    const { ctx, id } = await authorizedRequest();
    const { chain, pay, account } = mainnetSetup(ctx.db);
    mutate(chain);
    await assert.rejects(pay(id), MainnetGuardError);
    assert.equal(account.signCount, 0);
    assert.equal(chain.sentRaw.length, 0);
    assert.equal(repo.listPayments(ctx.db, id).length, 0);
    assert.equal(repo.getRequest(ctx.db, id)!.status, "authorized");
  });
}

test("mainnet sin wallet del agente → aborta", async () => {
  const { ctx, id } = await authorizedRequest();
  await assert.rejects(createPayTool({ db: ctx.db, mode: "mainnet", chain: null, account: null })(id), PaymentError);
  assert.equal(repo.listPayments(ctx.db, id).length, 0);
});
