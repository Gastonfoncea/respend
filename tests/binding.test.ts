import test from "node:test";
import assert from "node:assert/strict";
import { createPayTool } from "../lib/chain/payTool.ts";
import { correctFields } from "../lib/workflow.ts";
import * as repo from "../lib/repo.ts";
import { ORG } from "./helpers.ts";
import { authorizedRequest } from "./payments-helpers.ts";

test("autorizar → cambiar monto → autorización revocada → payTool se niega", async () => {
  const { ctx, id } = await authorizedRequest();
  const auth = repo.getActiveAuthorization(ctx.db, id)!;
  assert.ok(auth);
  correctFields(ctx, ORG, id, { date: "2026-10-15", merchant: "Remises del Centro SRL", concept: "Viaje", amount: "1.400,00", currency: "ARS", category: "transporte" });
  assert.equal(repo.getActiveAuthorization(ctx.db, id), null);
  assert.ok(repo.getAuthorization(ctx.db, auth.id)!.revoked_at);
  assert.equal(repo.getRequest(ctx.db, id)!.status, "analyzed");
  const pay = createPayTool({ db: ctx.db, mode: "simulated" });
  await assert.rejects(pay(id), /estado "analyzed"/);
  assert.equal(repo.listPayments(ctx.db, id).length, 0);
});

test("si el monto cambia por fuera del flujo, payTool detecta el binding distinto y revoca", async () => {
  const { ctx, id } = await authorizedRequest();
  ctx.db.prepare("UPDATE requests SET amount_cents = 199999 WHERE id = ?").run(id);
  const pay = createPayTool({ db: ctx.db, mode: "simulated" });
  await assert.rejects(pay(id), /autorización se revocó/);
  assert.equal(repo.getActiveAuthorization(ctx.db, id), null);
  assert.equal(repo.listPayments(ctx.db, id).length, 0);
});

test("simulado: pago confirmado, marcado como simulado y la solicitud queda reembolsada", async () => {
  const { ctx, id } = await authorizedRequest();
  const res = await createPayTool({ db: ctx.db, mode: "simulated" })(id);
  assert.equal(res.status, "confirmed");
  assert.equal(res.mode, "simulated");
  assert.equal(repo.getRequest(ctx.db, id)!.status, "reimbursed");
  assert.equal(repo.listPayments(ctx.db, id)[0].mode, "simulated");
});
