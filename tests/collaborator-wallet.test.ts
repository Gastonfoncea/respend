import test from "node:test";
import assert from "node:assert/strict";
import { AuthError } from "../lib/auth.ts";
import { analyzeRequest, authorize, setCollaboratorWallet, submitExpense, WorkflowError } from "../lib/workflow.ts";
import * as repo from "../lib/repo.ts";
import { makeCtx, COLLAB, ORG, RECIPIENT, tinyPng } from "./helpers.ts";

const OTHER = "0x2222222222222222222222222222222222222222";
const submit = (ctx: ReturnType<typeof makeCtx>, recipient: string, seed = 1) =>
  submitExpense(ctx, COLLAB, { description: "remís", recipient, file: { bytes: tinyPng(seed), mime: "image/png" } });

test("solo el colaborador define su wallet de cobro; el organizador no puede", () => {
  const ctx = makeCtx();
  assert.throws(
    () => setCollaboratorWallet(ctx, ORG, RECIPIENT),
    (e: unknown) => e instanceof AuthError && e.code === "forbidden",
  );
  assert.throws(
    () => setCollaboratorWallet(ctx, null, RECIPIENT),
    (e: unknown) => e instanceof AuthError && e.code === "unauthenticated",
  );
  assert.equal(repo.getCollaboratorWallet(ctx.db), null);
});

test("dirección inválida se rechaza; la válida se guarda con checksum y queda auditada", () => {
  const ctx = makeCtx();
  for (const bad of ["", "hola", "0x123", "0x" + "g".repeat(40)]) {
    assert.throws(() => setCollaboratorWallet(ctx, COLLAB, bad), WorkflowError);
  }
  const lower = "0x567b9e6c008cee9e41d9ba2f1dd582c1c68eead3";
  const saved = setCollaboratorWallet(ctx, COLLAB, ` ${lower} `);
  assert.equal(saved, "0x567B9e6c008Cee9E41D9ba2F1dD582c1c68eEad3");
  assert.equal(repo.getCollaboratorWallet(ctx.db), saved);
  const log = ctx.db.prepare("SELECT detail FROM audit_log WHERE action = 'collaborator_wallet_updated'").all() as { detail: string }[];
  assert.equal(log.length, 1);
  assert.deepEqual(JSON.parse(log[0].detail), { before: null, after: saved });
  // Guardar la misma dirección no genera otro registro.
  setCollaboratorWallet(ctx, COLLAB, saved);
  assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'collaborator_wallet_updated'").get() as { n: number }).n, 1);
});

test("con wallet en el perfil, un gasto no puede cobrarse en otra dirección", () => {
  const ctx = makeCtx();
  setCollaboratorWallet(ctx, COLLAB, RECIPIENT);
  assert.throws(() => submit(ctx, OTHER), /perfil/);
  const id = submit(ctx, RECIPIENT);
  assert.equal(repo.getRequest(ctx.db, id)!.recipient, RECIPIENT);
});

test("cambiar la wallet no modifica gastos ya presentados ni su autorización", async () => {
  const ctx = makeCtx();
  setCollaboratorWallet(ctx, COLLAB, RECIPIENT);
  const id = submit(ctx, RECIPIENT);
  await analyzeRequest(ctx, id);
  authorize(ctx, ORG, id, { verifiedAmountAndRecipient: true, reviewedAlerts: false, reason: "" });
  setCollaboratorWallet(ctx, COLLAB, OTHER);
  const r = repo.getRequest(ctx.db, id)!;
  assert.equal(r.recipient, RECIPIENT);
  assert.equal(r.status, "authorized");
  assert.equal(repo.getActiveAuthorization(ctx.db, id)!.recipient, RECIPIENT);
  // Los gastos nuevos ya usan la wallet nueva.
  assert.equal(repo.getRequest(ctx.db, submit(ctx, OTHER, 2))!.recipient, OTHER);
});
