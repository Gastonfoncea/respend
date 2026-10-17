// Guion completo de la demo con el analizador falso y pago simulado.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createFakeAnalyzer } from "../lib/agent/analyze.ts";
import { analyzeRequest, authorize, respondClarification, submitExpense } from "../lib/workflow.ts";
import { createPayTool } from "../lib/chain/payTool.ts";
import { getBudget } from "../lib/budget.ts";
import * as repo from "../lib/repo.ts";
import { DEMO_DESCRIPTIONS, DEMO_CLARIFICATION_02 } from "../lib/demo.ts";
import { makeCtx, COLLAB, ORG, RECIPIENT } from "./helpers.ts";

test("demo: 01 approve → pago simulado; 02 needs_info → aclaración → approve; 03 flag_review; 99 flag_review", async () => {
  const ctx = makeCtx(createFakeAnalyzer());
  const dir = path.join(process.cwd(), "demo", "receipts");
  const submit = (f: string) =>
    submitExpense(ctx, COLLAB, { description: DEMO_DESCRIPTIONS[f], recipient: RECIPIENT, file: { bytes: fs.readFileSync(path.join(dir, f)), mime: "image/png" } });
  const pay = createPayTool({ db: ctx.db, mode: "simulated" });

  const r1 = await analyzeRequest(ctx, submit("01-valido.png"));
  assert.equal(r1.recommendation, "approve");
  authorize(ctx, ORG, r1.id, { verifiedAmountAndRecipient: true, reviewedAlerts: false, reason: "" });
  assert.equal((await pay(r1.id)).status, "confirmed");

  const r2 = await analyzeRequest(ctx, submit("02-ambiguo.png"));
  assert.equal(r2.recommendation, "needs_info");
  assert.equal(r2.status, "needs_info");
  assert.ok(repo.listClarifications(ctx.db, r2.id).some((c) => c.author === "agent"));
  respondClarification(ctx, COLLAB, r2.id, DEMO_CLARIFICATION_02);
  const r2b = await analyzeRequest(ctx, r2.id);
  assert.equal(r2b.recommendation, "approve");
  assert.equal(r2b.category, "materiales");

  const r3 = await analyzeRequest(ctx, submit("03-duplicado.png"));
  assert.equal(r3.recommendation, "flag_review");
  assert.deepEqual(JSON.parse(r3.duplicate_flags!).file, [r1.id]);
  // flag_review: autorizar exige tildar "Revisé las alertas" y un motivo.
  assert.throws(() => authorize(ctx, ORG, r3.id, { verifiedAmountAndRecipient: true, reviewedAlerts: false, reason: "" }), /alertas/);

  const r4 = await analyzeRequest(ctx, submit("99-inyeccion.png"));
  assert.equal(r4.recommendation, "flag_review");
  assert.equal(r4.amount_cents, 90000);
  assert.equal(r4.recipient, RECIPIENT);

  assert.equal(getBudget(ctx.db).paidCents, 150000);
});
