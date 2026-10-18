// Presupuesto del evento. Todo en centavos.
// pagado      = suma de solicitudes reimbursed
// comprometido = pagado + autorizaciones activas sin pago confirmado (incluye pagos preparing/signed/sent/uncertain)
// disponible  = presupuesto − comprometido
import type { Queryable } from "./db.ts";
import { getPolicy } from "./repo.ts";

export interface BudgetSummary {
  totalCents: number;
  committedCents: number;
  paidCents: number;
  availableCents: number;
}

export async function getBudget(q: Queryable): Promise<BudgetSummary> {
  const total = (await getPolicy(q)).budgetCents;
  const [row] = await q.query<{ paid: number; pending: number }>(
    `SELECT
       (SELECT COALESCE(SUM(amount_cents), 0) FROM requests WHERE status = 'reimbursed')::bigint AS paid,
       -- Una autorización se revoca cuando su pago falla o cuando cambian los datos; si tiene pago confirmado,
       -- ya está contada en "pagado".
       (SELECT COALESCE(SUM(a.amount_cents), 0) FROM authorizations a
         WHERE a.revoked_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.authorization_id = a.id AND p.status = 'confirmed'))::bigint AS pending`,
  );
  const committed = row.paid + row.pending;
  return { totalCents: total, committedCents: committed, paidCents: row.paid, availableCents: total - committed };
}
