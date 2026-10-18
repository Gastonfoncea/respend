import test from "node:test";
import assert from "node:assert/strict";
import { analyzeRequest, authorize, submitExpense } from "../lib/workflow.ts";
import { getBudget } from "../lib/budget.ts";
import { makeCtx, scriptedAnalyzer, aiOut, COLLAB, ORG, RECIPIENT, tinyPng, type TestCtx } from "./helpers.ts";

const OK = { verifiedAmountAndRecipient: true, reviewedAlerts: false, reason: "" };

async function present(ctx: TestCtx, n: number) {
  const id = await submitExpense(ctx, COLLAB, { description: `gasto ${n}`, recipient: RECIPIENT, file: { bytes: tinyPng(n), mime: "image/png" } });
  return (await analyzeRequest(ctx, id)).id;
}

test("con $5.000: autorizar $2.000 + $2.000 y luego $1.500 → el tercero se rechaza", async () => {
  // Montos y comercios distintos para no disparar duplicado de datos.
  const amounts: Record<string, string> = { "gasto 1": "2000.00", "gasto 2": "2000.00", "gasto 3": "1500.00" };
  const ctx = await makeCtx(scriptedAnalyzer((d) => aiOut({ extracted: { amount: amounts[d], merchant: d } })));
  const a = await present(ctx, 1);
  const b = await present(ctx, 2);
  const c = await present(ctx, 3);
  await authorize(ctx, ORG, a, OK);
  await authorize(ctx, ORG, b, OK);
  assert.deepEqual(await getBudget(ctx.db), { totalCents: 500000, committedCents: 400000, paidCents: 0, availableCents: 100000 });
  await assert.rejects(() => authorize(ctx, ORG, c, OK), /presupuesto/);
});

test("un pago uncertain cuenta como comprometido", async () => {
  const ctx = await makeCtx();
  const a = await present(ctx, 1);
  const authId = await authorize(ctx, ORG, a, OK);
  const now = new Date().toISOString();
  await ctx.db.query("UPDATE requests SET status = 'payment_uncertain' WHERE id = $1", [a]);
  await ctx.db.query(
    "INSERT INTO payments (request_id, authorization_id, mode, status, created_at, updated_at) VALUES ($1, $2, 'mainnet', 'uncertain', $3, $3)",
    [a, authId, now],
  );
  assert.equal((await getBudget(ctx.db)).committedCents, 150000);
  assert.equal((await getBudget(ctx.db)).paidCents, 0);
});
