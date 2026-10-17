// Detección de duplicados: mismo archivo (sha256) o mismos datos (comercio normalizado + fecha + importe).
// Una coincidencia es motivo de revisión, no prueba de fraude.
import { createHash } from "node:crypto";
import type { DB } from "./db.ts";
import { findByDateAmount, findByFileSha } from "./repo.ts";
import type { DuplicateFlags, ReceiptFields } from "./types.ts";

export function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** "  Remises del  CENTRO S.R.L. " → "remises del centro srl" */
export function normalizeMerchant(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function findDuplicates(db: DB, requestId: number, fileSha256: string, fields: ReceiptFields): DuplicateFlags {
  const file = findByFileSha(db, fileSha256, requestId).map((r) => r.id);
  let data: number[] = [];
  if (fields.date && fields.amountCents != null && fields.merchant) {
    const m = normalizeMerchant(fields.merchant);
    data = findByDateAmount(db, fields.date, fields.amountCents, requestId)
      .filter((r) => r.merchant != null && normalizeMerchant(r.merchant) === m)
      .map((r) => r.id);
  }
  return { file, data };
}
