// "Binding" de una autorización: sha256 del JSON canónico de lo que el organizador autorizó.
// Si cualquiera de estos valores cambia, la autorización deja de valer.
import { createHash } from "node:crypto";
import { CHAIN_ID, WARS_ADDRESS } from "./config.ts";
import { centsToWei } from "./money.ts";
import type { RequestRow } from "./types.ts";

export interface BindingFields {
  request_id: number;
  amount_cents: number;
  token_amount: string; // wei, decimal
  token_address: string;
  chain_id: number;
  recipient: string;
  file_sha256: string;
  policy_version: number;
}

/** JSON con claves ordenadas, sin espacios. */
export function canonicalJson(obj: Record<string, string | number>): string {
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(obj[k])}`).join(",")}}`;
}

export function bindingFor(req: RequestRow, policyVersion: number): BindingFields {
  if (req.amount_cents == null) throw new Error("La solicitud no tiene importe");
  return {
    request_id: req.id,
    amount_cents: req.amount_cents,
    token_amount: centsToWei(req.amount_cents).toString(),
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
