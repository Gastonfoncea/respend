// Checks deterministas de la política. Los calcula el código, no la IA.
import { isAddress, getAddress } from "viem";
import { formatArs } from "./money.ts";
import type { Check, DuplicateFlags, Policy, ReceiptFields } from "./types.ts";

const ARS_ALIASES = new Set(["ARS", "$", "AR$", "$ARS", "ARS$", "PESOS", "PESO", "PESO ARGENTINO", "PESOS ARGENTINOS"]);

export function isArs(currency: string | null): boolean | null {
  if (currency == null || !currency.trim()) return null;
  return ARS_ALIASES.has(currency.trim().toUpperCase());
}

/** Dirección válida y con checksum correcto (si viene en mayúsculas/minúsculas mezcladas). */
export function isValidRecipient(addr: string): boolean {
  return isAddress(addr, { strict: true });
}

export function normalizeRecipient(addr: string): string | null {
  const a = addr.trim();
  if (!isAddress(a, { strict: true })) return null;
  return getAddress(a);
}

export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export interface CheckInput {
  policy: Policy;
  fields: ReceiptFields;
  recipient: string;
  /** Disponible para ESTA solicitud (disponible global + lo que ya tenga autorizado ella misma). */
  availableForRequestCents: number;
  duplicates: DuplicateFlags;
}

export function evaluateChecks(input: CheckInput): Check[] {
  const { policy, fields, recipient, availableForRequestCents, duplicates } = input;
  const checks: Check[] = [];

  if (fields.date == null || !isIsoDate(fields.date)) {
    checks.push({ rule: "date_in_range", ok: null, detail: "No se pudo leer la fecha del comprobante." });
  } else {
    const ok = fields.date >= policy.startDate && fields.date <= policy.endDate;
    checks.push({
      rule: "date_in_range",
      ok,
      detail: ok
        ? `Fecha ${fields.date} dentro del evento (${policy.startDate} a ${policy.endDate}).`
        : `Fecha ${fields.date} fuera del evento (${policy.startDate} a ${policy.endDate}).`,
    });
  }

  const ars = isArs(fields.currency);
  checks.push({
    rule: "currency_is_ars",
    ok: ars,
    detail:
      ars === null ? "No se pudo leer la moneda." : ars ? "Moneda: pesos argentinos (ARS)." : `Moneda "${fields.currency}" no es ARS.`,
  });

  const parsed = fields.amountCents != null;
  checks.push({
    rule: "amount_parsed",
    ok: parsed ? true : null,
    detail: parsed ? `Importe leído: ${formatArs(fields.amountCents!)}.` : "No se pudo leer el importe.",
  });

  if (fields.amountCents == null) {
    checks.push({ rule: "amount_le_cap", ok: null, detail: "Sin importe, no se puede comparar con el tope." });
  } else {
    const ok = fields.amountCents <= policy.capPerReceiptCents;
    checks.push({
      rule: "amount_le_cap",
      ok,
      detail: ok
        ? `${formatArs(fields.amountCents)} no supera el tope de ${formatArs(policy.capPerReceiptCents)} por comprobante.`
        : `${formatArs(fields.amountCents)} supera el tope de ${formatArs(policy.capPerReceiptCents)} por comprobante.`,
    });
  }

  if (fields.category == null || fields.category === "indeterminada") {
    checks.push({ rule: "category_allowed", ok: null, detail: "No se pudo determinar la categoría." });
  } else {
    const ok = policy.categories.includes(fields.category);
    checks.push({
      rule: "category_allowed",
      ok,
      detail: ok
        ? `Categoría "${fields.category}" permitida.`
        : `Categoría "${fields.category}" no está entre las permitidas (${policy.categories.join(", ")}).`,
    });
  }

  const recipientOk = isValidRecipient(recipient);
  checks.push({
    rule: "recipient_valid",
    ok: recipientOk,
    detail: recipientOk ? "Wallet de destino válida." : "La wallet de destino no es una dirección válida.",
  });

  if (fields.amountCents == null) {
    checks.push({ rule: "budget_available", ok: null, detail: "Sin importe, no se puede comparar con el presupuesto." });
  } else {
    const ok = fields.amountCents <= availableForRequestCents;
    checks.push({
      rule: "budget_available",
      ok,
      detail: ok
        ? `Hay presupuesto disponible (${formatArs(Math.max(availableForRequestCents, 0))}).`
        : `Presupuesto insuficiente: quedan ${formatArs(Math.max(availableForRequestCents, 0))}.`,
    });
  }

  checks.push({
    rule: "duplicate_file",
    ok: duplicates.file.length === 0,
    detail: duplicates.file.length
      ? `El archivo es idéntico al de la solicitud ${duplicates.file.map((i) => `#${i}`).join(", ")}.`
      : "El archivo no coincide con otra solicitud.",
  });
  checks.push({
    rule: "duplicate_data",
    ok: duplicates.data.length === 0,
    detail: duplicates.data.length
      ? `Mismo comercio, fecha e importe que la solicitud ${duplicates.data.map((i) => `#${i}`).join(", ")}.`
      : "No hay otra solicitud con el mismo comercio, fecha e importe.",
  });

  return checks;
}

export function checkOf(checks: Check[], rule: Check["rule"]): Check | undefined {
  return checks.find((c) => c.rule === rule);
}
