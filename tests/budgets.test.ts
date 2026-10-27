// Presupuesto por evento y por persona (docs/SPEC-limites-por-persona.md §7). Sin red ni IA.
import test from "node:test";
import assert from "node:assert/strict";
import { AuthError } from "../lib/auth.ts";
import { analyzeRequest, authorize, autoAuthorize, correctFields, previewExpense, submitExpense, WorkflowError } from "../lib/workflow.ts";
import { createBudget, saveCategory, setAssignment, updateBudget } from "../lib/budgetAdmin.ts";
import * as budgets from "../lib/budgets.ts";
import { addMember } from "../lib/members.ts";
import { createPayTool } from "../lib/chain/payTool.ts";
import { maybeAutoPay } from "../lib/autopay.ts";
import { bindingFor, bindingHash } from "../lib/binding.ts";
import * as repo from "../lib/repo.ts";
import type { Session } from "../lib/types.ts";
import { aiOut, makeCtx, scriptedAnalyzer, setAutoPayMax, BUDGET_ID, COLLAB, COLLAB_ID, ORG, tinyPng, type TestCtx } from "./helpers.ts";

const OK = { verifiedAmountAndRecipient: true, reviewedAlerts: false, reason: "" };
const SOFI_WALLET = "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359";

/** "<monto> <categoría> <comercio>" → ticket del 15/10 con ese importe, categoría y comercio (distintos entre sí). */
async function ctxBudget() {
  const ctx = await makeCtx(
    scriptedAnalyzer((d) => {
      const [amount, category, ...rest] = d.split(" ");
      return aiOut({ extracted: { amount, merchant: `Comercio ${rest.join(" ")}` }, category });
    }),
  );
  return ctx;
}

let seed = 5000;
async function analyzed(ctx: TestCtx, session: Session, description: string, budgetId = BUDGET_ID) {
  const id = await submitExpense(ctx, session, { description, budgetId, file: { bytes: tinyPng(seed++), mime: "image/png" } });
  await analyzeRequest(ctx, id);
  return id;
}

async function lastSkip(ctx: TestCtx, id: number): Promise<string | null> {
  const a = [...(await repo.listAudit(ctx.db, id))].reverse().find((x) => x.action === "auto_pay_skipped");
  return a ? (JSON.parse(a.detail!) as { reason: string }).reason : null;
}

/** Deja al colaborador de la demo con una sola asignación (sin categoría) de `cents`. */
async function onlyAssignment(ctx: TestCtx, cents: number) {
  await setAssignment(ctx, ORG, { budgetId: BUDGET_ID, memberId: COLLAB_ID, categoryKey: null, amountCents: cents });
}

test("1. saldo: consumido suma autorizaciones no revocadas; no cuentan revocadas ni pagos fallidos", async () => {
  const ctx = await ctxBudget();
  await onlyAssignment(ctx, 100000);
  const a = await analyzed(ctx, COLLAB, "300.00 transporte a");
  const b = await analyzed(ctx, COLLAB, "200.00 transporte b");
  await authorize(ctx, ORG, a, OK);
  const authB = await authorize(ctx, ORG, b, OK);
  const asg = (await budgets.listAssignments(ctx.db, BUDGET_ID)).find((x) => x.member_id === COLLAB_ID)!;
  assert.deepEqual(await budgets.balanceOf(ctx.db, asg).then((x) => [x.consumedCents, x.availableCents]), [50000, 50000]);
  await repo.revokeAuthorization(ctx.db, authB, "pago fallido");
  assert.deepEqual(await budgets.balanceOf(ctx.db, asg).then((x) => [x.consumedCents, x.availableCents]), [30000, 70000]);
});

test("2. la asignación de la categoría tiene prioridad sobre la asignación sin categoría", async () => {
  const ctx = await ctxBudget();
  await setAssignment(ctx, ORG, { budgetId: BUDGET_ID, memberId: COLLAB_ID, categoryKey: "transporte", amountCents: 20000 });
  const t = await analyzed(ctx, COLLAB, "50.00 transporte t");
  const m = await analyzed(ctx, COLLAB, "50.00 materiales m");
  const tr = (await repo.getRequest(ctx.db, t))!;
  const mr = (await repo.getRequest(ctx.db, m))!;
  assert.equal((await budgets.getAssignment(ctx.db, tr.assignment_id!))!.category_key, "transporte");
  assert.equal((await budgets.getAssignment(ctx.db, mr.assignment_id!))!.category_key, null);
});

test("3. pago automático: pasa con todo OK", async () => {
  const ctx = await ctxBudget();
  const id = await analyzed(ctx, COLLAB, "100.00 transporte ok");
  assert.equal((await maybeAutoPay(ctx, id, createPayTool({ db: ctx.db, mode: "simulated" })))?.status, "confirmed");
  const [auth] = await repo.listAuthorizations(ctx.db, id);
  assert.equal(auth.mode, "auto");
  assert.equal(auth.assignment_id, (await repo.getRequest(ctx.db, id))!.assignment_id);
});

test("3. pago automático: cada una de las 7 condiciones, por separado, lo manda al owner y queda en el audit_log", async () => {
  // 1. Con alertas (duplicado de datos).
  {
    const ctx = await ctxBudget();
    const a = await analyzed(ctx, COLLAB, "100.00 transporte igual");
    await authorize(ctx, ORG, a, OK);
    const b = await analyzed(ctx, COLLAB, "100.00 transporte igual");
    assert.equal(await autoAuthorize(ctx, b), null);
    assert.equal(await lastSkip(ctx, b), "not_approved");
  }
  // 2. Intervino un humano (corrigió los datos).
  {
    const ctx = await ctxBudget();
    await setAutoPayMax(ctx.db, 0);
    const id = await analyzed(ctx, COLLAB, "90.00 transporte h");
    await correctFields(ctx, ORG, id, { date: "2026-10-15", merchant: "X", concept: "viaje", amount: "90.00", currency: "ARS", category: "transporte" });
    await setAutoPayMax(ctx.db, 10000);
    assert.equal(await autoAuthorize(ctx, id), null);
    assert.equal(await lastSkip(ctx, id), "human_intervened");
  }
  // 3. Límite duro: no alcanza el presupuesto total.
  {
    const ctx = await ctxBudget();
    await repo.upsertEvent(ctx.db, { name: "x", capPerReceiptCents: 200000, budgetCents: 5000 });
    const id = await analyzed(ctx, COLLAB, "100.00 transporte d");
    assert.equal(await autoAuthorize(ctx, id), null);
  }
  // 4. Presupuesto cerrado (y ticket fuera de fechas: ver test 9).
  {
    const ctx = await ctxBudget();
    const id = await analyzed(ctx, COLLAB, "100.00 transporte c");
    await ctx.db.query("UPDATE budgets SET status = 'closed' WHERE id = $1", [BUDGET_ID]);
    assert.equal(await autoAuthorize(ctx, id), null);
    assert.equal(await lastSkip(ctx, id), "budget_closed_or_out_of_dates");
  }
  // 5. Supera el saldo de la asignación.
  {
    const ctx = await ctxBudget();
    await onlyAssignment(ctx, 5000);
    const id = await analyzed(ctx, COLLAB, "100.00 transporte s");
    assert.equal(await autoAuthorize(ctx, id), null);
    assert.equal(await lastSkip(ctx, id), "over_balance");
  }
  // 6. Supera el máximo por ticket del presupuesto.
  {
    const ctx = await ctxBudget();
    const id = await analyzed(ctx, COLLAB, "100.01 transporte m");
    assert.equal(await autoAuthorize(ctx, id), null);
    assert.equal(await lastSkip(ctx, id), "over_max_per_receipt");
  }
  // 7. Tope de 24 h.
  {
    const ctx = await ctxBudget();
    await ctx.db.query("UPDATE agent_settings SET auto_pay_daily_cap_cents = 5000");
    await repo.setAutoPayDailyCapCents(ctx.db, 5000);
    const id = await analyzed(ctx, COLLAB, "100.00 transporte cap");
    assert.equal(await autoAuthorize(ctx, id), null);
    assert.equal(await lastSkip(ctx, id), "daily_cap");
  }
});

test("4. un ticket mayor al máximo por ticket pero dentro del saldo va al owner, que lo paga completo", async () => {
  const ctx = await ctxBudget();
  const id = await analyzed(ctx, COLLAB, "600.00 transporte grande");
  assert.equal(await autoAuthorize(ctx, id), null);
  const authId = await authorize(ctx, ORG, id, { ...OK, decision: "full" });
  const auth = (await repo.getAuthorization(ctx.db, authId))!;
  assert.equal(auth.mode, "full");
  assert.equal(auth.amount_cents, 60000);
});

test("5. un ticket mayor al saldo nunca se paga parcial solo", async () => {
  const ctx = await ctxBudget();
  await onlyAssignment(ctx, 3000);
  const id = await analyzed(ctx, COLLAB, "45.00 transporte saldo");
  assert.equal(await autoAuthorize(ctx, id), null);
  assert.equal((await repo.listAuthorizations(ctx.db, id)).length, 0);
  // "Pagar" completo no se puede: el owner elige hasta el saldo o excepción.
  await assert.rejects(authorize(ctx, ORG, id, { ...OK, decision: "full" }), /saldo/);
});

test("6. pagar hasta el saldo: paga lo disponible y el binding queda con ese importe", async () => {
  const ctx = await ctxBudget();
  await onlyAssignment(ctx, 3000);
  const id = await analyzed(ctx, COLLAB, "45.00 transporte parcial");
  const authId = await authorize(ctx, ORG, id, { ...OK, decision: "up_to_balance" });
  const auth = (await repo.getAuthorization(ctx.db, authId))!;
  assert.equal(auth.mode, "up_to_balance");
  assert.equal(auth.amount_cents, 3000);
  assert.equal(auth.requested_cents, 4500);
  const r = (await repo.getRequest(ctx.db, id))!;
  const expected = bindingHash(bindingFor(r, auth.policy_version, { approvedCents: 3000, assignmentId: auth.assignment_id, mode: "up_to_balance" }));
  assert.equal(auth.binding_hash, expected);
  const res = await createPayTool({ db: ctx.db, mode: "simulated" })(id);
  assert.equal(res.status, "confirmed");
  const asg = (await budgets.getAssignment(ctx.db, auth.assignment_id!))!;
  assert.equal((await budgets.balanceOf(ctx.db, asg)).availableCents, 0);
});

test("7. excepción: sin motivo se rechaza; con motivo paga todo y el disponible queda en 0 (nunca negativo)", async () => {
  const ctx = await ctxBudget();
  await onlyAssignment(ctx, 3000);
  const id = await analyzed(ctx, COLLAB, "45.00 transporte excepcion");
  await assert.rejects(authorize(ctx, ORG, id, { ...OK, decision: "exception" }), /motivo/);
  const authId = await authorize(ctx, ORG, id, { ...OK, decision: "exception", reason: "lo aprobé por teléfono" });
  const auth = (await repo.getAuthorization(ctx.db, authId))!;
  assert.equal(auth.amount_cents, 4500);
  assert.equal(auth.exception_cents, 1500);
  assert.equal(auth.exception_reason, "lo aprobé por teléfono");
  const asg = (await budgets.getAssignment(ctx.db, auth.assignment_id!))!;
  const bal = await budgets.balanceOf(ctx.db, asg);
  assert.equal(bal.consumedCents, 4500);
  assert.equal(bal.availableCents, 0);
});

test("8. concurrencia: dos pagos automáticos simultáneos de la misma asignación no superan el saldo", async () => {
  const ctx = await ctxBudget();
  await onlyAssignment(ctx, 15000);
  const a = await analyzed(ctx, COLLAB, "100.00 transporte uno");
  const b = await analyzed(ctx, COLLAB, "100.00 transporte dos");
  const results = await Promise.all([autoAuthorize(ctx, a), autoAuthorize(ctx, b)]);
  assert.equal(results.filter((x) => x != null).length, 1);
  const asg = (await budgets.listAssignments(ctx.db, BUDGET_ID)).find((x) => x.member_id === COLLAB_ID)!;
  assert.equal((await budgets.balanceOf(ctx.db, asg)).consumedCents, 10000);
});

test("9. ticket fuera de las fechas del presupuesto → no se paga solo (y la política lo marca fuera)", async () => {
  const ctx = await makeCtx(scriptedAnalyzer(() => aiOut({ extracted: { amount: "50.00", date: "2026-11-02" } })));
  const id = await analyzed(ctx, COLLAB, "fuera");
  assert.equal(await autoAuthorize(ctx, id), null);
  assert.equal((await repo.getRequest(ctx.db, id))!.recommendation, "reject");
});

test("sin asignación para la categoría: va a revisión con el motivo; sin ningún presupuesto, no se puede presentar", async () => {
  const ctx = await ctxBudget();
  // Solo transporte: un ticket de materiales no tiene asignación.
  await ctx.db.query("DELETE FROM assignments");
  await setAssignment(ctx, ORG, { budgetId: BUDGET_ID, memberId: COLLAB_ID, categoryKey: "transporte", amountCents: 50000 });
  const id = await analyzed(ctx, COLLAB, "50.00 materiales cinta");
  const r = (await repo.getRequest(ctx.db, id))!;
  assert.equal(r.recommendation, "flag_review");
  assert.match(r.explanation ?? "", /no tiene presupuesto asignado/);
  // Otra persona sin ninguna asignación no puede presentar.
  const sofiId = await addMember(ctx, ORG, { email: "sofi@x.com", name: "Sofi", role: "collaborator", wallet: SOFI_WALLET });
  const SOFI: Session = { memberId: sofiId, role: "collaborator", name: "Sofi", issuedAt: Date.now() };
  await assert.rejects(submitExpense(ctx, SOFI, { description: "x", file: { bytes: tinyPng(seed++), mime: "image/png" } }), /presupuesto asignado/);
});

test("bajar una asignación no revoca lo autorizado; lo analizado sin autorizar se re-evalúa", async () => {
  const ctx = await ctxBudget();
  await setAutoPayMax(ctx.db, 0);
  const a = await analyzed(ctx, COLLAB, "100.00 transporte autorizada");
  const pending = await analyzed(ctx, COLLAB, "100.00 transporte pendiente");
  await authorize(ctx, ORG, a, OK);
  await onlyAssignment(ctx, 0);
  assert.ok(await repo.getActiveAuthorization(ctx.db, a));
  assert.ok((await repo.listAudit(ctx.db, pending)).some((x) => x.action === "reevaluated"));
});

test("solo el organizador administra presupuestos, asignaciones y categorías", async () => {
  const ctx = await makeCtx();
  const forbidden = (e: unknown) => e instanceof AuthError && e.code === "forbidden";
  await assert.rejects(createBudget(ctx, COLLAB, { name: "x y", startsOn: "2026-10-01", endsOn: "2026-10-31", autopayMaxCents: 0 }), forbidden);
  await assert.rejects(setAssignment(ctx, COLLAB, { budgetId: BUDGET_ID, memberId: COLLAB_ID, categoryKey: null, amountCents: 1 }), forbidden);
  await assert.rejects(saveCategory(ctx, COLLAB, { key: "catering", name: "Catering", description: "", active: true }), forbidden);
  await assert.rejects(createBudget(ctx, ORG, { name: "x y", startsOn: "2026-10-31", endsOn: "2026-10-01", autopayMaxCents: 0 }), /Fechas/);
  await assert.rejects(saveCategory(ctx, ORG, { key: "otra", name: "Otra", description: "", active: true }), WorkflowError);
  await assert.rejects(setAssignment(ctx, ORG, { budgetId: BUDGET_ID, memberId: 1, categoryKey: null, amountCents: 1 }), /colaboradores/);
  // Una categoría nueva queda disponible para el agente y para asignar.
  await saveCategory(ctx, ORG, { key: "catering", name: "Catering", description: "Comida y bebida para asistentes", active: true });
  assert.ok((await budgets.policyFor(ctx.db, BUDGET_ID)).categories.includes("catering"));
  const id = await createBudget(ctx, ORG, { name: "Octubre 2026", startsOn: "2026-10-01", endsOn: "2026-10-31", autopayMaxCents: 5000 });
  await setAssignment(ctx, ORG, { budgetId: id, memberId: COLLAB_ID, categoryKey: "catering", amountCents: 80000 });
  await updateBudget(ctx, ORG, id, { name: "Octubre 2026", startsOn: "2026-10-01", endsOn: "2026-10-31", autopayMaxCents: 5000, status: "closed" });
  assert.equal((await budgets.getBudgetById(ctx.db, id))!.status, "closed");
});

test("la vista previa dice cuánto le queda y si se lo pagaría solo", async () => {
  const ctx = await makeCtx(); // ticket de $ 1.500 (aiOut por defecto)
  await onlyAssignment(ctx, 8000);
  const over = await previewExpense(ctx, COLLAB, { bytes: tinyPng(seed++) });
  assert.ok(over.ok);
  if (!over.ok) return;
  assert.equal(over.availableCents, 8000);
  assert.match(over.autoPay ?? "", /Supera lo que te queda/);
});
