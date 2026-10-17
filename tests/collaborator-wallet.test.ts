import test from "node:test";
import assert from "node:assert/strict";
import { AuthError } from "../lib/auth.ts";
import { analyzeRequest, authorize, setCollaboratorProfile, submitExpense, WorkflowError } from "../lib/workflow.ts";
import * as repo from "../lib/repo.ts";
import { openDb } from "../lib/db.ts";
import { makeCtx, COLLAB, ORG, RECIPIENT, tinyPng } from "./helpers.ts";

const OTHER = "0x2222222222222222222222222222222222222222";
const submit = (ctx: ReturnType<typeof makeCtx>, recipient: string, seed = 1) =>
  submitExpense(ctx, COLLAB, { description: "remís", recipient, file: { bytes: tinyPng(seed), mime: "image/png" } });

test("solo el colaborador define su perfil de cobro; el organizador no puede", () => {
  const ctx = makeCtx();
  assert.throws(
    () => setCollaboratorProfile(ctx, ORG, { name: "Ana", wallet: RECIPIENT }),
    (e: unknown) => e instanceof AuthError && e.code === "forbidden",
  );
  assert.throws(
    () => setCollaboratorProfile(ctx, null, { name: "Ana", wallet: RECIPIENT }),
    (e: unknown) => e instanceof AuthError && e.code === "unauthenticated",
  );
  assert.equal(repo.getCollaboratorProfile(ctx.db), null);
});

test("nombre y wallet se validan; se guardan normalizados y quedan auditados", () => {
  const ctx = makeCtx();
  for (const bad of ["", "hola", "0x123", "0x" + "g".repeat(40)]) {
    assert.throws(() => setCollaboratorProfile(ctx, COLLAB, { name: "Ana", wallet: bad }), WorkflowError);
  }
  for (const bad of ["", " ", "A", "x".repeat(61)]) {
    assert.throws(() => setCollaboratorProfile(ctx, COLLAB, { name: bad, wallet: RECIPIENT }), WorkflowError);
  }
  const lower = "0x567b9e6c008cee9e41d9ba2f1dd582c1c68eead3";
  const saved = setCollaboratorProfile(ctx, COLLAB, { name: "  Gastón \n  Foncea ", wallet: ` ${lower} ` });
  assert.deepEqual(saved, { name: "Gastón Foncea", wallet: "0x567B9e6c008Cee9E41D9ba2F1dD582c1c68eEad3" });
  assert.deepEqual(repo.getCollaboratorProfile(ctx.db), saved);
  const count = () =>
    (ctx.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'collaborator_profile_updated'").get() as { n: number }).n;
  assert.equal(count(), 1);
  // Guardar lo mismo no genera otro registro.
  setCollaboratorProfile(ctx, COLLAB, saved);
  assert.equal(count(), 1);
});

test("cada solicitud guarda quién la reclama (copia del nombre al presentar)", () => {
  const ctx = makeCtx();
  setCollaboratorProfile(ctx, COLLAB, { name: "Gastón", wallet: RECIPIENT });
  const id = submit(ctx, RECIPIENT);
  assert.equal(repo.getRequest(ctx.db, id)!.claimant_name, "Gastón");
  // Si después cambia el nombre, la solicitud vieja conserva el de cuando la presentó.
  setCollaboratorProfile(ctx, COLLAB, { name: "Gastón F.", wallet: RECIPIENT });
  assert.equal(repo.getRequest(ctx.db, id)!.claimant_name, "Gastón");
  assert.equal(repo.getRequest(ctx.db, submit(ctx, RECIPIENT, 2))!.claimant_name, "Gastón F.");
});

test("con wallet en el perfil, un gasto no puede cobrarse en otra dirección", () => {
  const ctx = makeCtx();
  setCollaboratorProfile(ctx, COLLAB, { name: "Ana", wallet: RECIPIENT });
  assert.throws(() => submit(ctx, OTHER), /perfil/);
  const id = submit(ctx, RECIPIENT);
  assert.equal(repo.getRequest(ctx.db, id)!.recipient, RECIPIENT);
});

test("cambiar la wallet no modifica gastos ya presentados ni su autorización", async () => {
  const ctx = makeCtx();
  setCollaboratorProfile(ctx, COLLAB, { name: "Ana", wallet: RECIPIENT });
  const id = submit(ctx, RECIPIENT);
  await analyzeRequest(ctx, id);
  authorize(ctx, ORG, id, { verifiedAmountAndRecipient: true, reviewedAlerts: false, reason: "" });
  setCollaboratorProfile(ctx, COLLAB, { name: "Ana", wallet: OTHER });
  const r = repo.getRequest(ctx.db, id)!;
  assert.equal(r.recipient, RECIPIENT);
  assert.equal(r.status, "authorized");
  assert.equal(repo.getActiveAuthorization(ctx.db, id)!.recipient, RECIPIENT);
  assert.equal(repo.getRequest(ctx.db, submit(ctx, OTHER, 2))!.recipient, OTHER);
});

test("migración: una base vieja sin las columnas nuevas se actualiza sin perder datos", () => {
  const ctx = makeCtx();
  ctx.db.exec("DROP TABLE collaborator_profile");
  ctx.db.exec("CREATE TABLE collaborator_profile (id INTEGER PRIMARY KEY CHECK (id = 1), wallet TEXT NOT NULL, updated_at TEXT NOT NULL)");
  ctx.db.exec(`INSERT INTO collaborator_profile VALUES (1, '${RECIPIENT}', '2026-10-17')`);
  ctx.db.close();
  const db = openDb(ctx.dbPath);
  assert.deepEqual(repo.getCollaboratorProfile(db), { name: null, wallet: RECIPIENT });
  db.close();
});
