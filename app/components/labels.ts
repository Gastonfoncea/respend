import type { CheckRule, PaymentStatus, Recommendation, RequestRow, RequestStatus } from "@/lib/types.ts";
import type { Tone } from "./ui.tsx";

export const STATUS_LABEL: Record<RequestStatus, string> = {
  submitted: "Presentada",
  analyzed: "Analizada · espera al organizador",
  needs_info: "Necesita aclaración",
  rejected: "Rechazada",
  authorized: "Autorizada",
  paying: "Pagando",
  reimbursed: "Reembolsada",
  payment_failed: "Pago fallido",
  payment_uncertain: "Pago incierto · reconciliar",
};

export const REC_LABEL: Record<Recommendation, string> = {
  approve: "Aprobar",
  needs_info: "Pedir aclaración",
  flag_review: "Revisar",
  reject: "Rechazar",
};

export const RULE_LABEL: Record<CheckRule, string> = {
  date_in_range: "Fecha dentro del evento",
  currency_is_ars: "Moneda ARS",
  amount_parsed: "Importe legible",
  amount_le_cap: "No supera el tope por comprobante",
  category_allowed: "Categoría permitida",
  recipient_valid: "Wallet de destino válida",
  budget_available: "Hay presupuesto",
  duplicate_file: "Archivo no repetido",
  duplicate_data: "Datos no repetidos",
  budget_window: "Presupuesto abierto",
  assignment_found: "Tiene presupuesto asignado",
};

export const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  preparing: "Preparando",
  signed: "Firmada (sin difundir)",
  sent: "Enviada, esperando confirmación",
  confirmed: "Confirmada",
  failed: "Fallida",
  uncertain: "Incierta",
};

export function recClass(r: Recommendation | null): string {
  return r ? `badge rec-${r}` : "badge";
}

export function statusClass(s: RequestStatus): string {
  return `badge st-${s}`;
}

// --- Etiquetas cortas por rol para listas y estados (UI B2) ---

export interface StatusView {
  label: string;
  tone: Tone;
}

const REC_SHORT: Record<Recommendation, StatusView> = {
  approve: { label: "Aprobar", tone: "green" },
  flag_review: { label: "Revisar alertas", tone: "amb" },
  needs_info: { label: "Pedir info", tone: "amb" },
  reject: { label: "Rechazar", tone: "red" },
};

/** Qué ve el organizador en la lista y en "Agente". */
export function orgStatus(r: Pick<RequestRow, "status" | "recommendation">): StatusView {
  switch (r.status) {
    case "analyzed":
      return r.recommendation ? REC_SHORT[r.recommendation] : { label: "Analizada", tone: "dim" };
    case "submitted":
      return { label: "Sin análisis", tone: "dim" };
    case "needs_info":
      return { label: "Falta info", tone: "amb" };
    case "authorized":
      return { label: "Autorizada", tone: "green" };
    case "paying":
      return { label: "Pagando", tone: "green" };
    case "reimbursed":
      return { label: "Pagado", tone: "dim" };
    case "rejected":
      return { label: "Rechazado", tone: "dim" };
    case "payment_failed":
      return { label: "Pago fallido", tone: "red" };
    case "payment_uncertain":
      return { label: "Reconciliar", tone: "amb" };
  }
}

/** Qué ve el colaborador. */
export function collabStatus(r: Pick<RequestRow, "status">): StatusView {
  switch (r.status) {
    case "submitted":
      return { label: "Sin analizar", tone: "dim" };
    case "needs_info":
      return { label: "Responder", tone: "amb" };
    case "authorized":
    case "paying":
      return { label: "Cobrando", tone: "green" };
    case "reimbursed":
      return { label: "Cobrado", tone: "green" };
    case "rejected":
      return { label: "Rechazado", tone: "red" };
    default:
      return { label: "En revisión", tone: "dim" };
  }
}

export function recView(r: Recommendation | null): StatusView | null {
  return r ? REC_SHORT[r] : null;
}
