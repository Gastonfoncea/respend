// Presupuesto del evento. Todo en centavos.
// pagado      = suma de solicitudes reimbursed
// comprometido = pagado + autorizaciones activas sin pago confirmado (incluye pagos preparing/signed/sent/uncertain)
// disponible  = presupuesto − comprometido
import type { DB } from "./db.ts";
import { getPolicy } from "./repo.ts";

export interface BudgetSummary {
  totalCents: number;
  committedCents: number;
  paidCents: number;
  availableCents: number;
}

export function getBudget(db: DB): BudgetSummary {
  const total = getPolicy(db).budgetCents;
  const paid = (
    db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS s FROM requests WHERE status = 'reimbursed'").get() as { s: number }
  ).s;
  // Una autorización se revoca cuando su pago falla o cuando cambian los datos; si tiene pago confirmado,
  // ya está contada en "pagado".
  const pending = (
    db
      .prepare(
        `SELECT COALESCE(SUM(a.amount_cents), 0) AS s FROM authorizations a
         WHERE a.revoked_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.authorization_id = a.id AND p.status = 'confirmed')`,
      )
      .get() as { s: number }
  ).s;
  const committed = paid + pending;
  return { totalCents: total, committedCents: committed, paidCents: paid, availableCents: total - committed };
}
