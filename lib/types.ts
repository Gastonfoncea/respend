// Tipos compartidos del dominio. Montos ARS en centavos (enteros), wARS en wei como string decimal.

export type Role = "organizer" | "collaborator";

/** Sesión vigente: el miembro que entró. El rol y el nombre salen de la base en cada pedido. */
export interface Session {
  memberId: number;
  role: Role;
  name: string;
  issuedAt: number;
}

export interface MemberRow {
  id: number;
  auth_user_id: string | null;
  email: string;
  name: string;
  role: Role;
  wallet: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export type RequestStatus =
  | "submitted"
  | "analyzed"
  | "needs_info"
  | "rejected"
  | "authorized"
  | "paying"
  | "reimbursed"
  | "payment_failed"
  | "payment_uncertain";

export type Recommendation = "approve" | "needs_info" | "flag_review" | "reject";

export type PaymentStatus = "preparing" | "signed" | "sent" | "confirmed" | "failed" | "uncertain";

/** Política general (una por instalación): nombre, tope por ticket y presupuesto total. */
export interface EventRow {
  id: number;
  name: string;
  cap_per_receipt_cents: number;
  budget_cents: number;
  policy_version: number;
  created_at: string;
  updated_at: string;
}

/** Política general: lo que vale para todos los presupuestos. */
export interface GeneralPolicy {
  name: string;
  capPerReceiptCents: number;
  budgetCents: number;
  version: number;
}

/**
 * Política con la que se evalúa un gasto: la general más el presupuesto al que se presenta
 * (nombre y fechas) y las categorías activas.
 */
export interface Policy extends GeneralPolicy {
  budgetId: number | null;
  startDate: string;
  endDate: string;
  /** Claves de las categorías activas. */
  categories: string[];
  /** Nombre y descripción de cada una: el agente las usa para clasificar. */
  categoryInfo: { key: string; name: string; description: string }[];
}

export interface RequestRow {
  id: number;
  created_at: string;
  updated_at: string;
  description: string;
  recipient: string;
  /** Nombre que declaró el colaborador al presentar (copia; no cambia si después edita su perfil). */
  claimant_name: string | null;
  member_id: number | null;
  budget_id: number | null;
  assignment_id: number | null;
  file_path: string;
  file_sha256: string;
  mime: string;
  status: RequestStatus;
  ai_output: string | null;
  ai_model: string | null;
  ai_provider: string | null;
  ai_ran_at: string | null;
  ai_error: string | null;
  ai_fake: number;
  receipt_date: string | null;
  merchant: string | null;
  concept: string | null;
  amount_cents: number | null;
  currency: string | null;
  category: string | null;
  fields_source: "ai" | "organizer" | null;
  checks: string | null;
  duplicate_flags: string | null;
  recommendation: Recommendation | null;
  explanation: string | null;
  policy_version: number | null;
}

export interface ClarificationRow {
  id: number;
  request_id: number;
  author: "agent" | "collaborator" | "organizer";
  message: string;
  created_at: string;
}

export type AuthorizationMode = "auto" | "full" | "up_to_balance" | "exception";

export interface AuthorizationRow {
  id: number;
  request_id: number;
  /** Lo aprobado: lo que se paga. */
  amount_cents: number;
  /** El importe del ticket al autorizar. */
  requested_cents: number | null;
  assignment_id: number | null;
  /** Lo que se pagó por encima del saldo de la asignación (solo mode = exception). */
  exception_cents: number;
  exception_reason: string | null;
  mode: AuthorizationMode;
  token_amount: string;
  token_address: string;
  chain_id: number;
  recipient: string;
  binding_hash: string;
  policy_version: number;
  authorized_by: string;
  review_note: string | null;
  created_at: string;
  revoked_at: string | null;
  revoke_reason: string | null;
}

export interface PaymentRow {
  id: number;
  request_id: number;
  authorization_id: number;
  mode: "simulated" | "mainnet";
  status: PaymentStatus;
  from_address: string | null;
  nonce: number | null;
  raw_tx: string | null;
  tx_hash: string | null;
  block_number: number | null;
  attribution_ok: number | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditRow {
  id: number;
  request_id: number | null;
  actor: string;
  action: string;
  detail: string | null;
  created_at: string;
}

/** Campos vigentes del comprobante (de la IA o corregidos por el organizador). */
export interface ReceiptFields {
  date: string | null;
  merchant: string | null;
  concept: string | null;
  amountCents: number | null;
  currency: string | null;
  category: string | null;
}

export interface Check {
  rule: CheckRule;
  /** true = pasa, false = falla, null = no se puede evaluar (falta el dato). */
  ok: boolean | null;
  detail: string;
}

export type CheckRule =
  | "date_in_range"
  | "currency_is_ars"
  | "amount_parsed"
  | "amount_le_cap"
  | "category_allowed"
  | "recipient_valid"
  | "budget_available"
  | "budget_window"
  | "assignment_found"
  | "duplicate_file"
  | "duplicate_data";

export interface DuplicateFlags {
  file: number[];
  data: number[];
}

export interface Explanation {
  summary: string;
  agentText: string | null;
  rules: Check[];
  evidence: string[];
}

export interface CategoryRow {
  key: string;
  name: string;
  description: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface BudgetRow {
  id: number;
  name: string;
  starts_on: string;
  ends_on: string;
  autopay_max_per_receipt_cents: number;
  status: "open" | "closed";
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface AssignmentRow {
  id: number;
  budget_id: number;
  member_id: number;
  category_key: string | null;
  amount_cents: number;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

/** Saldo de una asignación: consumido = autorizaciones no revocadas; disponible nunca es negativo. */
export interface AssignmentBalance {
  assignment: AssignmentRow;
  consumedCents: number;
  availableCents: number;
}
