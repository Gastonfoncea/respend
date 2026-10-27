// Acciones del organizador sobre presupuestos, asignaciones y categorías. Todo con rol verificado y auditado.
import { tx } from "./db.ts";
import * as repo from "./repo.ts";
import * as budgets from "./budgets.ts";
import { assertRole, actorName } from "./auth.ts";
import { assertCents, formatArs } from "./money.ts";
import { isIsoDate } from "./policy.ts";
import { reevaluateOpen, WorkflowError, type Ctx } from "./workflow.ts";
import type { BudgetRow, Session } from "./types.ts";

export interface BudgetInput {
  name: string;
  startsOn: string;
  endsOn: string;
  autopayMaxCents: number;
}

function cleanBudget(input: BudgetInput, capCents: number): BudgetInput {
  const name = input.name.replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 80) throw new WorkflowError("El presupuesto necesita un nombre (2 a 80 caracteres).");
  if (!isIsoDate(input.startsOn) || !isIsoDate(input.endsOn) || input.startsOn > input.endsOn) throw new WorkflowError("Fechas inválidas.");
  assertCents(input.autopayMaxCents);
  if (input.autopayMaxCents > capCents) throw new WorkflowError(`El máximo del pago automático no puede superar el tope por ticket (${formatArs(capCents)}).`);
  return { ...input, name };
}

export async function createBudget(ctx: Ctx, session: Session | null, input: BudgetInput): Promise<number> {
  const s = assertRole(session, ["organizer"]);
  const b = cleanBudget(input, (await repo.getPolicy(ctx.db)).capPerReceiptCents);
  return tx(ctx.db, async (q) => {
    const id = await budgets.insertBudget(q, { ...b, createdBy: s.memberId });
    await repo.audit(q, null, actorName(s), "budget_created", { budget_id: id, ...b });
    return id;
  });
}

/** Editar o cerrar/reabrir. Las solicitudes analizadas sin autorizar se re-evalúan con los datos nuevos. */
export async function updateBudget(
  ctx: Ctx,
  session: Session | null,
  budgetId: number,
  input: BudgetInput & { status: BudgetRow["status"] },
): Promise<void> {
  const s = assertRole(session, ["organizer"]);
  if (input.status !== "open" && input.status !== "closed") throw new WorkflowError("Estado inválido.");
  const b = cleanBudget(input, (await repo.getPolicy(ctx.db)).capPerReceiptCents);
  await tx(ctx.db, async (q) => {
    const before = await budgets.getBudgetById(q, budgetId);
    if (!before) throw new WorkflowError("Ese presupuesto no existe.");
    await budgets.updateBudgetRow(q, budgetId, { ...b, status: input.status });
    await repo.audit(q, null, actorName(s), "budget_updated", { budget_id: budgetId, before, after: { ...b, status: input.status } });
    const ids = (await q.query<{ id: number }>("SELECT id FROM requests WHERE budget_id = $1 AND status = 'analyzed'", [budgetId])).map((r) => r.id);
    await reevaluateOpen(q, ids, actorName(s), "budget_updated");
  });
}

export interface AssignmentInput {
  budgetId: number;
  memberId: number;
  /** null o "" = cualquier categoría. */
  categoryKey: string | null;
  amountCents: number;
}

/**
 * Crea o cambia una asignación. Bajarla no revoca autorizaciones ya dadas; las solicitudes de esa persona en
 * ese presupuesto que estaban analizadas y sin autorizar se re-evalúan.
 */
export async function setAssignment(ctx: Ctx, session: Session | null, input: AssignmentInput): Promise<number> {
  const s = assertRole(session, ["organizer"]);
  assertCents(input.amountCents);
  const categoryKey = input.categoryKey?.trim() || null;
  return tx(ctx.db, async (q) => {
    const budget = await budgets.getBudgetById(q, input.budgetId);
    if (!budget) throw new WorkflowError("Ese presupuesto no existe.");
    const member = await repo.getMember(q, input.memberId);
    if (!member || !member.active) throw new WorkflowError("Esa persona no está activa en el equipo.");
    if (member.role !== "collaborator") throw new WorkflowError("Las asignaciones son para colaboradores.");
    if (categoryKey && !(await budgets.getCategory(q, categoryKey))?.active) throw new WorkflowError("Esa categoría no existe o está inactiva.");
    const { id, beforeCents } = await budgets.upsertAssignment(q, { ...input, categoryKey, by: s.memberId });
    await repo.audit(q, null, actorName(s), "assignment_set", {
      assignment_id: id,
      budget_id: input.budgetId,
      member_id: input.memberId,
      category_key: categoryKey,
      before_cents: beforeCents,
      after_cents: input.amountCents,
    });
    const ids = (
      await q.query<{ id: number }>("SELECT id FROM requests WHERE budget_id = $1 AND member_id = $2 AND status = 'analyzed'", [input.budgetId, input.memberId])
    ).map((r) => r.id);
    await reevaluateOpen(q, ids, actorName(s), "assignment_set");
    return id;
  });
}

export interface CategoryInput {
  key: string;
  name: string;
  description: string;
  active: boolean;
}

/** Crea o edita una categoría. La clave no cambia (la usan solicitudes y asignaciones). */
export async function saveCategory(ctx: Ctx, session: Session | null, input: CategoryInput): Promise<void> {
  const s = assertRole(session, ["organizer"]);
  const key = input.key.trim().toLowerCase();
  if (!/^[a-z_]{2,30}$/.test(key) || key === "otra" || key === "indeterminada") {
    throw new WorkflowError("La clave va en minúsculas, sin espacios ni tildes (ej.: catering), y no puede ser \"otra\" ni \"indeterminada\".");
  }
  const name = input.name.replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 40) throw new WorkflowError("El nombre de la categoría tiene que tener entre 2 y 40 caracteres.");
  const description = input.description.replace(/\s+/g, " ").trim().slice(0, 300);
  await tx(ctx.db, async (q) => {
    if (!input.active && (await budgets.listCategories(q, true)).filter((c) => c.key !== key).length === 0) {
      throw new WorkflowError("Tiene que quedar al menos una categoría activa.");
    }
    const before = await budgets.getCategory(q, key);
    await budgets.upsertCategory(q, { key, name, description, active: input.active });
    await repo.audit(q, null, actorName(s), before ? "category_updated" : "category_created", { key, before, after: { name, description, active: input.active } });
  });
}
