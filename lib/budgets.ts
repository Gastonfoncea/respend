// Presupuestos, asignaciones y categorías: consultas y cálculos deterministas (sin IA).
// Las acciones del organizador viven en lib/budgetAdmin.ts; el pago automático, en lib/workflow.ts.
import type { Queryable } from "./db.ts";
import { nowIso } from "./db.ts";
import * as repo from "./repo.ts";
import type { AssignmentBalance, AssignmentRow, BudgetRow, CategoryRow, Policy } from "./types.ts";

async function one<T>(q: Queryable, sql: string, params: unknown[] = []): Promise<T | null> {
  return ((await q.query<T>(sql, params))[0] as T | undefined) ?? null;
}

// --- categorías ---

export function listCategories(q: Queryable, onlyActive = false): Promise<CategoryRow[]> {
  return q.query<CategoryRow>(`SELECT * FROM categories ${onlyActive ? "WHERE active" : ""} ORDER BY name, key`);
}

export function getCategory(q: Queryable, key: string): Promise<CategoryRow | null> {
  return one<CategoryRow>(q, "SELECT * FROM categories WHERE key = $1", [key]);
}

export async function upsertCategory(q: Queryable, c: Pick<CategoryRow, "key" | "name" | "description" | "active">): Promise<void> {
  const now = nowIso();
  await q.query(
    `INSERT INTO categories (key, name, description, active, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)
     ON CONFLICT (key) DO UPDATE SET name = excluded.name, description = excluded.description, active = excluded.active,
       updated_at = excluded.updated_at`,
    [c.key, c.name, c.description, c.active, now],
  );
}

// --- presupuestos ---

export function listBudgets(q: Queryable): Promise<BudgetRow[]> {
  return q.query<BudgetRow>("SELECT * FROM budgets ORDER BY status DESC, starts_on DESC, id DESC");
}

export function getBudgetById(q: Queryable, id: number): Promise<BudgetRow | null> {
  return one<BudgetRow>(q, "SELECT * FROM budgets WHERE id = $1", [id]);
}

export async function insertBudget(
  q: Queryable,
  b: { name: string; startsOn: string; endsOn: string; autopayMaxCents: number; createdBy: number | null },
): Promise<number> {
  const now = nowIso();
  const [row] = await q.query<{ id: number }>(
    `INSERT INTO budgets (name, starts_on, ends_on, autopay_max_per_receipt_cents, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING id`,
    [b.name, b.startsOn, b.endsOn, b.autopayMaxCents, b.createdBy, now],
  );
  return row.id;
}

export async function updateBudgetRow(
  q: Queryable,
  id: number,
  b: { name: string; startsOn: string; endsOn: string; autopayMaxCents: number; status: BudgetRow["status"] },
): Promise<void> {
  await q.query(
    `UPDATE budgets SET name = $1, starts_on = $2, ends_on = $3, autopay_max_per_receipt_cents = $4, status = $5, updated_at = $6 WHERE id = $7`,
    [b.name, b.startsOn, b.endsOn, b.autopayMaxCents, b.status, nowIso(), id],
  );
}

// --- asignaciones ---

export function listAssignments(q: Queryable, budgetId: number): Promise<AssignmentRow[]> {
  return q.query<AssignmentRow>("SELECT * FROM assignments WHERE budget_id = $1 ORDER BY member_id, category_key NULLS LAST, id", [budgetId]);
}

export function assignmentsOfMember(q: Queryable, memberId: number): Promise<AssignmentRow[]> {
  return q.query<AssignmentRow>("SELECT * FROM assignments WHERE member_id = $1 ORDER BY budget_id DESC, category_key NULLS LAST", [memberId]);
}

export function getAssignment(q: Queryable, id: number): Promise<AssignmentRow | null> {
  return one<AssignmentRow>(q, "SELECT * FROM assignments WHERE id = $1", [id]);
}

/** Crea o actualiza la asignación de esa persona, presupuesto y categoría (NULL = cualquier categoría). */
export async function upsertAssignment(
  q: Queryable,
  a: { budgetId: number; memberId: number; categoryKey: string | null; amountCents: number; by: number | null },
): Promise<{ id: number; beforeCents: number | null }> {
  const before = await one<AssignmentRow>(
    q,
    "SELECT * FROM assignments WHERE budget_id = $1 AND member_id = $2 AND category_key IS NOT DISTINCT FROM $3",
    [a.budgetId, a.memberId, a.categoryKey],
  );
  const now = nowIso();
  if (before) {
    await q.query("UPDATE assignments SET amount_cents = $1, updated_at = $2 WHERE id = $3", [a.amountCents, now, before.id]);
    return { id: before.id, beforeCents: before.amount_cents };
  }
  const [row] = await q.query<{ id: number }>(
    `INSERT INTO assignments (budget_id, member_id, category_key, amount_cents, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING id`,
    [a.budgetId, a.memberId, a.categoryKey, a.amountCents, a.by, now],
  );
  return { id: row.id, beforeCents: null };
}

/**
 * Consumido = suma de lo aprobado en autorizaciones NO revocadas de la asignación (pendientes, pagando,
 * inciertas o pagadas). Un pago fallido revoca su autorización, así que no cuenta. Disponible nunca es negativo.
 * Dentro de tx() el lock global de escritura evita que dos pagos automáticos lean el mismo saldo.
 */
export async function balanceOf(q: Queryable, a: AssignmentRow, excludeRequestId: number | null = null): Promise<AssignmentBalance> {
  const [row] = await q.query<{ c: number }>(
    `SELECT COALESCE(SUM(amount_cents), 0)::bigint AS c FROM authorizations
     WHERE assignment_id = $1 AND revoked_at IS NULL AND ($2::int IS NULL OR request_id <> $2)`,
    [a.id, excludeRequestId],
  );
  return { assignment: a, consumedCents: row.c, availableCents: Math.max(a.amount_cents - row.c, 0) };
}

/**
 * A qué asignación va un gasto: la de la categoría que leyó el agente, si existe; si no, la "sin categoría"
 * de esa persona en ese presupuesto. null si no hay ninguna.
 */
export async function resolveAssignment(
  q: Queryable,
  memberId: number,
  budgetId: number,
  category: string | null,
): Promise<AssignmentRow | null> {
  const rows = await q.query<AssignmentRow>(
    "SELECT * FROM assignments WHERE budget_id = $1 AND member_id = $2 AND (category_key = $3 OR category_key IS NULL) ORDER BY category_key NULLS LAST",
    [budgetId, memberId, category],
  );
  return rows[0] ?? null;
}

/** Presupuestos abiertos donde la persona tiene alguna asignación (los que puede elegir al presentar). */
export function openBudgetsOfMember(q: Queryable, memberId: number): Promise<BudgetRow[]> {
  return q.query<BudgetRow>(
    `SELECT DISTINCT b.* FROM budgets b JOIN assignments a ON a.budget_id = b.id
     WHERE a.member_id = $1 AND b.status = 'open' ORDER BY b.starts_on DESC, b.id DESC`,
    [memberId],
  );
}

/**
 * Política con la que se evalúa un gasto: la general + nombre y fechas del presupuesto + categorías activas.
 * Sin presupuesto (gastos de antes de los presupuestos), fechas abiertas.
 */
export async function policyFor(q: Queryable, budgetId: number | null): Promise<Policy> {
  const general = await repo.getPolicy(q);
  const active = await listCategories(q, true);
  const categories = active.map((c) => c.key);
  const categoryInfo = active.map((c) => ({ key: c.key, name: c.name, description: c.description }));
  const b = budgetId != null ? await getBudgetById(q, budgetId) : null;
  return {
    ...general,
    name: b?.name ?? general.name,
    budgetId: b?.id ?? null,
    startDate: b?.starts_on ?? "0000-01-01",
    endDate: b?.ends_on ?? "9999-12-31",
    categories,
    categoryInfo,
  };
}
