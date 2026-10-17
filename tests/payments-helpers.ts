import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { LocalAccount } from "viem/accounts";
import { FakeChain } from "../lib/chain/fakeChain.ts";
import { createPayTool } from "../lib/chain/payTool.ts";
import { WARS_ADDRESS } from "../lib/config.ts";
import { analyzeRequest, authorize, submitExpense } from "../lib/workflow.ts";
import type { DB } from "../lib/db.ts";
import { makeCtx, COLLAB, ORG, RECIPIENT, tinyPng } from "./helpers.ts";

/** Cuenta efímera en memoria con un contador de firmas. */
export function spyAccount(): LocalAccount & { signCount: number } {
  const base = privateKeyToAccount(generatePrivateKey());
  const acc = {
    ...base,
    signCount: 0,
    async signTransaction(...args: Parameters<typeof base.signTransaction>) {
      acc.signCount += 1;
      return base.signTransaction(...args);
    },
  };
  return acc as LocalAccount & { signCount: number };
}

export async function authorizedRequest(seed = 1) {
  const ctx = makeCtx();
  const id = submitExpense(ctx, COLLAB, { description: `gasto ${seed}`, recipient: RECIPIENT, file: { bytes: tinyPng(seed), mime: "image/png" } });
  await analyzeRequest(ctx, id);
  authorize(ctx, ORG, id, { verifiedAmountAndRecipient: true, reviewedAlerts: false, reason: "" });
  return { ctx, id };
}

export function mainnetSetup(db: DB) {
  const account = spyAccount();
  const chain = new FakeChain({ token: WARS_ADDRESS, sender: account.address });
  const pay = createPayTool({ db, mode: "mainnet", chain, account, receiptTimeoutMs: 10 });
  return { account, chain, pay };
}
