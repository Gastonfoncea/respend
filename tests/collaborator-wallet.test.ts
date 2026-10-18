import test from "node:test";
import assert from "node:assert/strict";
import { AuthError } from "../lib/auth.ts";
import { analyzeRequest, authorize, setCollaboratorProfile, submitExpense, WorkflowError } from "../lib/workflow.ts";
import * as repo from "../lib/repo.ts";
import { makeCtx, COLLAB, ORG, RECIPIENT, tinyPng, type TestCtx } from "./helpers.ts";

const OTHER = "0x2222222222222222222222222222222222222222";
const submit = (ctx: TestCtx, recipient: string, seed = 1) => submitExpense(ctx, COLLAB, { description: "remís", recipient, file: { bytes: tinyPng(seed), mime: "image/png" } });

test("solo el colaborador define su perfil de cobro; el organizador no puede", async () => {
  const ctx = await makeCtx();
  await assert.rejects(
    () => setCollaboratorProfile(ctx, ORG, { name: "Ana", wallet: RECIPIENT }),
    (e: unknown) => e instanceof AuthError && e.code === "forbidden",
  );
  await assert.rejects(
    () => setCollaboratorProfile(ctx, null, { name: "Ana", wallet: RECIPIENT }),
    (e: unknown) => e instanceof AuthError && e.code === "unauthenticated",
  );
  assert.equal(await repo.getCollaboratorProfile(ctx.db), null);
});

test("nombre y wallet se validan; se guardan normalizados y quedan auditados", async () => {
  const ctx = await makeCtx();
  for (const bad of ["", "hola", "0x123", "0x" + "g".repeat(40)]) {
    await assert.rejects(() => setCollaboratorProfile(ctx, COLLAB, { name: "Ana", wallet: bad }), WorkflowError);
  }
  for (const bad of ["", " ", "A", "x".repeat(61)]) {
    await assert.rejects(() => setCollaboratorProfile(ctx, COLLAB, { name: bad, wallet: RECIPIENT }), WorkflowError);
  }
  const lower = "0x567b9e6c008cee9e41d9ba2f1dd582c1c68eead3";
  const saved = await setCollaboratorProfile(ctx, COLLAB, { name: "  Gastón \n  Foncea ", wallet: ` ${lower} ` });
  assert.deepEqual(saved, { name: "Gastón Foncea", wallet: "0x567B9e6c008Cee9E41D9ba2F1dD582c1c68eEad3" });
  assert.deepEqual(await repo.getCollaboratorProfile(ctx.db), saved);
  const count = async () =>
    (await ctx.db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM audit_log WHERE action = 'collaborator_profile_updated'"))[0].n;
  assert.equal(await count(), 1);
  // Guardar lo mismo no genera otro registro.
  await setCollaboratorProfile(ctx, COLLAB, saved);
  assert.equal(await count(), 1);
});

test("cada solicitud guarda quién la reclama (copia del nombre al presentar)", async () => {
  const ctx = await makeCtx();
  await setCollaboratorProfile(ctx, COLLAB, { name: "Gastón", wallet: RECIPIENT });
  const id = await submit(ctx, RECIPIENT);
  assert.equal((await repo.getRequest(ctx.db, id))!.claimant_name, "Gastón");
  // Si después cambia el nombre, la solicitud vieja conserva el de cuando la presentó.
  await setCollaboratorProfile(ctx, COLLAB, { name: "Gastón F.", wallet: RECIPIENT });
  assert.equal((await repo.getRequest(ctx.db, id))!.claimant_name, "Gastón");
  assert.equal((await repo.getRequest(ctx.db, await submit(ctx, RECIPIENT, 2)))!.claimant_name, "Gastón F.");
});

test("con wallet en el perfil, un gasto no puede cobrarse en otra dirección", async () => {
  const ctx = await makeCtx();
  await setCollaboratorProfile(ctx, COLLAB, { name: "Ana", wallet: RECIPIENT });
  await assert.rejects(() => submit(ctx, OTHER), /perfil/);
  const id = await submit(ctx, RECIPIENT);
  assert.equal((await repo.getRequest(ctx.db, id))!.recipient, RECIPIENT);
});

test("cambiar la wallet no modifica gastos ya presentados ni su autorización", async () => {
  const ctx = await makeCtx();
  await setCollaboratorProfile(ctx, COLLAB, { name: "Ana", wallet: RECIPIENT });
  const id = await submit(ctx, RECIPIENT);
  await analyzeRequest(ctx, id);
  await authorize(ctx, ORG, id, { verifiedAmountAndRecipient: true, reviewedAlerts: false, reason: "" });
  await setCollaboratorProfile(ctx, COLLAB, { name: "Ana", wallet: OTHER });
  const r = (await repo.getRequest(ctx.db, id))!;
  assert.equal(r.recipient, RECIPIENT);
  assert.equal(r.status, "authorized");
  assert.equal((await repo.getActiveAuthorization(ctx.db, id))!.recipient, RECIPIENT);
  assert.equal((await repo.getRequest(ctx.db, await submit(ctx, OTHER, 2)))!.recipient, OTHER);
});
