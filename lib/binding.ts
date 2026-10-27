// "Binding" de una autorización: sha256 del JSON canónico de lo que el organizador autorizó.
// Si cualquiera de estos valores cambia, la autorización deja de valer.
import { createHash } from "node:crypto";
import { CHAIN_ID, WARS_ADDRESS } from "./config.ts";
import { centsToWei } from "./money.ts";
import type { AuthorizationMode, RequestRow } from "./types.ts";

export interface BindingFields {
  request_id: number;
  /** Lo aprobado (lo que se paga). */
  amount_cents: number;
  /** El importe del ticket: si el organizador lo corrige, la autorización deja de valer. */
  requested_cents: number;
  assignment_id: number;
  member_id: number;
  mode: AuthorizationMode;
  token_amount: string; // wei, decimal
  token_address: string;
  chain_id: number;
  recipient: string;
  file_sha256: string;
  policy_version: number;
}

/** JSON con claves ordenadas, sin espacios. */
export function canonicalJson(obj: Record<string, string | number | null>): string {
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(obj[k])}`).join(",")}}`;
}

export interface Approval {
  approvedCents: number;
  assignmentId: number | null;
  mode: AuthorizationMode;
}

/**
 * Qué se autoriza. Sin `approval`, se paga el importe completo del ticket (modo "full").
 * assignment_id y member_id van como 0 cuando no hay (gastos de antes de los presupuestos).
 */
export function bindingFor(req: RequestRow, policyVersion: number, approval?: Approval): BindingFields {
  if (req.amount_cents == null) throw new Error("La solicitud no tiene importe");
  const approved = approval?.approvedCents ?? req.amount_cents;
  return {
    request_id: req.id,
    amount_cents: approved,
    requested_cents: req.amount_cents,
    assignment_id: approval?.assignmentId ?? 0,
    member_id: req.member_id ?? 0,
    mode: approval?.mode ?? "full",
    token_amount: centsToWei(approved).toString(),
    token_address: WARS_ADDRESS,
    chain_id: CHAIN_ID,
    recipient: req.recipient,
    file_sha256: req.file_sha256,
    policy_version: policyVersion,
  };
}

export function bindingHash(b: BindingFields): string {
  return createHash("sha256").update(canonicalJson({ ...b })).digest("hex");
}
