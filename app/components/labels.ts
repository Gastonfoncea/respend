import type { CheckRule, PaymentStatus, Recommendation, RequestStatus } from "@/lib/types.ts";

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
