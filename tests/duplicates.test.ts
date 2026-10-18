import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMerchant } from "../lib/duplicates.ts";
import { analyzeRequest, submitExpense } from "../lib/workflow.ts";
import { makeCtx, scriptedAnalyzer, aiOut, COLLAB, RECIPIENT, tinyPng } from "./helpers.ts";

test("normaliza comercio: mayúsculas, espacios, acentos, puntuación", async () => {
  assert.equal(normalizeMerchant("  Almacén   DON tito  "), normalizeMerchant("almacen don Tito"));
  assert.equal(normalizeMerchant("Remises del Centro S.R.L."), "remises del centro srl");
});

test("archivo idéntico → flag_review", async () => {
  const ctx = await makeCtx();
  const png = tinyPng(1);
  const a = await submitExpense(ctx, COLLAB, { description: "uno", recipient: RECIPIENT, file: { bytes: png, mime: "image/png" } });
  assert.equal((await analyzeRequest(ctx, a)).recommendation, "approve");
  const b = await submitExpense(ctx, COLLAB, { description: "dos", recipient: RECIPIENT, file: { bytes: png, mime: "image/png" } });
  const rb = await analyzeRequest(ctx, b);
  assert.equal(rb.recommendation, "flag_review");
  assert.deepEqual(JSON.parse(rb.duplicate_flags!).file, [a]);
});

test("mismos datos con comercio escrito distinto → flag_review", async () => {
  const ctx = await makeCtx(
    scriptedAnalyzer((d) => aiOut({ extracted: { merchant: d === "uno" ? "Remises del Centro SRL" : "REMISES  DEL CÉNTRO srl" } })),
  );
  const a = await submitExpense(ctx, COLLAB, { description: "uno", recipient: RECIPIENT, file: { bytes: tinyPng(1), mime: "image/png" } });
  await analyzeRequest(ctx, a);
  const b = await submitExpense(ctx, COLLAB, { description: "dos", recipient: RECIPIENT, file: { bytes: tinyPng(2), mime: "image/png" } });
  const rb = await analyzeRequest(ctx, b);
  assert.equal(rb.recommendation, "flag_review");
  assert.deepEqual(JSON.parse(rb.duplicate_flags!), { file: [], data: [a] });
});

test("una solicitud rechazada no cuenta como duplicado de datos", async () => {
  const ctx = await makeCtx();
  const a = await submitExpense(ctx, COLLAB, { description: "uno", recipient: RECIPIENT, file: { bytes: tinyPng(1), mime: "image/png" } });
  await analyzeRequest(ctx, a);
  await ctx.db.query("UPDATE requests SET status = 'rejected' WHERE id = $1", [a]);
  const b = await submitExpense(ctx, COLLAB, { description: "dos", recipient: RECIPIENT, file: { bytes: tinyPng(2), mime: "image/png" } });
  assert.equal((await analyzeRequest(ctx, b)).recommendation, "approve");
});
