// Dinero sin floats.
// - ARS en centavos: entero seguro de JS (Number.isSafeInteger), que es lo que guarda SQLite.
// - wARS en wei: bigint (18 decimales). 1 ARS = 1 wARS nominal → wei = centavos × 10^16.
// Todo el parseo se hace con strings y BigInt; nunca se usa parseFloat.
import { WEI_PER_CENT } from "./config.ts";

export class MoneyParseError extends Error {}

const MAX_CENTS = BigInt(Number.MAX_SAFE_INTEGER);

function toSafeCents(pesos: string, decimals: string): number {
  const cents = BigInt(pesos) * 100n + BigInt(decimals.padEnd(2, "0"));
  if (cents > MAX_CENTS) throw new MoneyParseError("Importe demasiado grande");
  // Conversión entero → entero, dentro del rango seguro verificado arriba.
  return Number(cents);
}

/**
 * Parsea un importe en ARS escrito por una persona o por la IA y devuelve centavos.
 * Acepta: "1.500,00", "1500.00", "$ 1.500", "1500", "1500,50", "ARS 1.500.000,00".
 * Rechaza lo ambiguo: "1,5", "1.5", "1,500", "1.50.0", negativos, vacíos.
 */
export function parseArsToCents(input: string): number {
  if (typeof input !== "string") throw new MoneyParseError("Importe inválido");
  const s = input
    .trim()
    .replace(/^ars\s*/i, "")
    .replace(/^\$\s*/, "")
    .replace(/\s*ars$/i, "")
    .replace(/\s+/g, "");
  if (!s) throw new MoneyParseError("Importe vacío");
  if (!/^[0-9.,]+$/.test(s)) throw new MoneyParseError(`Importe inválido: "${input}"`);

  const hasDot = s.includes(".");
  const hasComma = s.includes(",");

  // Sin separadores: pesos enteros.
  if (!hasDot && !hasComma) return toSafeCents(s, "");

  if (hasDot && hasComma) {
    const lastDot = s.lastIndexOf(".");
    const lastComma = s.lastIndexOf(",");
    const decSep = lastDot > lastComma ? "." : ",";
    const thouSep = decSep === "." ? "," : ".";
    const [intPart, dec, ...rest] = s.split(decSep);
    if (rest.length || dec === undefined || !/^\d{2}$/.test(dec)) {
      throw new MoneyParseError(`Importe ambiguo: "${input}"`);
    }
    return toSafeCents(parseGrouped(intPart, thouSep, input), dec);
  }

  const sep = hasDot ? "." : ",";
  const parts = s.split(sep);
  const last = parts[parts.length - 1];
  if (parts.length === 2 && /^\d{2}$/.test(last) && /^\d+$/.test(parts[0])) {
    // "1500.00" o "1500,00": separador decimal con exactamente dos decimales.
    return toSafeCents(parts[0], last);
  }
  if (sep === "." && parts.length >= 2 && parts.every((p, i) => (i === 0 ? /^\d{1,3}$/.test(p) : /^\d{3}$/.test(p)))) {
    // "1.500" o "1.500.000": punto como separador de miles (uso rioplatense).
    return toSafeCents(parts.join(""), "");
  }
  // "1,5", "1.5", "1,500" (¿mil quinientos o uno con cinco?), etc.
  throw new MoneyParseError(`Importe ambiguo: "${input}"`);
}

function parseGrouped(intPart: string, thouSep: string, original: string): string {
  if (!intPart.includes(thouSep)) {
    if (!/^\d+$/.test(intPart)) throw new MoneyParseError(`Importe inválido: "${original}"`);
    return intPart;
  }
  const groups = intPart.split(thouSep);
  const ok = groups.every((g, i) => (i === 0 ? /^\d{1,3}$/.test(g) : /^\d{3}$/.test(g)));
  if (!ok) throw new MoneyParseError(`Importe ambiguo: "${original}"`);
  return groups.join("");
}

/** Igual que parseArsToCents pero devuelve null en vez de tirar. */
export function tryParseArsToCents(input: string | null | undefined): number | null {
  if (input == null) return null;
  try {
    return parseArsToCents(input);
  } catch {
    return null;
  }
}

export function assertCents(cents: number): void {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new MoneyParseError("Centavos inválidos");
}

export function centsToWei(cents: number): bigint {
  assertCents(cents);
  return BigInt(cents) * WEI_PER_CENT;
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** 150000 → "$ 1.500,00" */
export function formatArs(cents: number): string {
  assertCents(cents);
  const c = BigInt(cents);
  const pesos = (c / 100n).toString();
  const dec = (c % 100n).toString().padStart(2, "0");
  return `$ ${groupThousands(pesos)},${dec}`;
}

/** 1500 × 10^18 → "1.500,00 wARS". Si el wei no es múltiplo de un centavo, muestra todos los decimales. */
export function formatWars(wei: bigint): string {
  if (wei < 0n) throw new MoneyParseError("Monto negativo");
  const unit = 10n ** 18n;
  const whole = groupThousands((wei / unit).toString());
  const frac = (wei % unit).toString().padStart(18, "0");
  const shown = wei % WEI_PER_CENT === 0n ? frac.slice(0, 2) : frac.replace(/0+$/, "");
  return `${whole},${shown} wARS`;
}

/** Centavos → "1500.00" (formato que usa el schema de la IA). */
export function centsToDecimalString(cents: number): string {
  assertCents(cents);
  const c = BigInt(cents);
  return `${c / 100n}.${(c % 100n).toString().padStart(2, "0")}`;
}
