import test from "node:test";
import assert from "node:assert/strict";
import { signSession, verifySession, checkPasscode, AuthError } from "../lib/auth.ts";
import { analyzeRequest, authorize, correctFields, rejectRequest, submitExpense, updatePolicy, requestClarification } from "../lib/workflow.ts";
import { DEMO_POLICY } from "../lib/demo.ts";
import { makeCtx, COLLAB, ORG, RECIPIENT, tinyPng } from "./helpers.ts";

const SECRET = "test-secret-0123456789";

test("cookie firmada: válida, adulterada y con otro secreto", () => {
  const tok = signSession({ role: "collaborator", issuedAt: Date.now() }, SECRET);
  assert.equal(verifySession(tok, SECRET)?.role, "collaborator");
  // Cambiar el rol en el payload sin re-firmar.
  const [, sig] = tok.split(".");
  const forged = Buffer.from(JSON.stringify({ r: "organizer", t: Date.now() })).toString("base64url");
  assert.equal(verifySession(`${forged}.${sig}`, SECRET), null);
  // Firma alterada.
  assert.equal(verifySession(tok.slice(0, -2) + (tok.endsWith("AA") ? "BB" : "AA"), SECRET), null);
  assert.equal(verifySession(tok, "otro-secreto"), null);
  assert.equal(verifySession("basura", SECRET), null);
  assert.equal(verifySession(tok, null), null);
});

test("sesión vencida se rechaza", () => {
  const old = Date.now() - 8 * 24 * 3600 * 1000;
  assert.equal(verifySession(signSession({ role: "organizer", issuedAt: old }, SECRET), SECRET), null);
});

test("passcode", () => {
  assert.equal(checkPasscode("1234", "1234"), true);
  assert.equal(checkPasscode("1235", "1234"), false);
  assert.equal(checkPasscode("1234", null), false);
});

test("el colaborador no puede autorizar, corregir, rechazar, pedir aclaración ni cambiar la política", async () => {
  const ctx = makeCtx();
  const id = submitExpense(ctx, COLLAB, { description: "x", recipient: RECIPIENT, file: { bytes: tinyPng(1), mime: "image/png" } });
  await analyzeRequest(ctx, id);
  const forbidden = (fn: () => unknown) => assert.throws(fn, (e: unknown) => e instanceof AuthError && e.code === "forbidden");
  forbidden(() => authorize(ctx, COLLAB, id, { verifiedAmountAndRecipient: true, reviewedAlerts: true, reason: "x" }));
  forbidden(() => correctFields(ctx, COLLAB, id, { date: null, merchant: null, concept: null, amount: "1", currency: null, category: null }));
  forbidden(() => rejectRequest(ctx, COLLAB, id, ""));
  forbidden(() => requestClarification(ctx, COLLAB, id, "?"));
  forbidden(() => updatePolicy(ctx, COLLAB, DEMO_POLICY));
  // Sin sesión.
  assert.throws(() => authorize(ctx, null, id, { verifiedAmountAndRecipient: true, reviewedAlerts: true, reason: "" }), AuthError);
  // El organizador no presenta gastos.
  forbidden(() => submitExpense(ctx, ORG, { description: "x", recipient: RECIPIENT, file: { bytes: tinyPng(2), mime: "image/png" } }));
});

test("la política se bloquea cuando hay solicitudes", () => {
  const ctx = makeCtx();
  updatePolicy(ctx, ORG, { ...DEMO_POLICY, name: "Otro nombre" });
  submitExpense(ctx, COLLAB, { description: "x", recipient: RECIPIENT, file: { bytes: tinyPng(1), mime: "image/png" } });
  assert.throws(() => updatePolicy(ctx, ORG, DEMO_POLICY), /bloqueada/);
});

test("presentar valida imagen y wallet", () => {
  const ctx = makeCtx();
  assert.throws(
    () => submitExpense(ctx, COLLAB, { description: "x", recipient: "0x123", file: { bytes: tinyPng(1), mime: "image/png" } }),
    /wallet/,
  );
  assert.throws(
    () => submitExpense(ctx, COLLAB, { description: "x", recipient: RECIPIENT, file: { bytes: new TextEncoder().encode("<svg/>"), mime: "image/png" } }),
    /JPEG, PNG o WebP/,
  );
});
