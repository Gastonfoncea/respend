// Política de la demo (PLAN.md §10).
import type { Policy } from "./types.ts";

export const DEMO_POLICY: Omit<Policy, "version"> = {
  name: "Meetup Stable Agents BA",
  startDate: "2026-10-10",
  endDate: "2026-10-18",
  categories: ["transporte", "materiales"],
  capPerReceiptCents: 200000,
  budgetCents: 500000,
};

/** Límite de pago automático por defecto (si el organizador no configuró otro): 100 wARS, inclusive. */
export const DEFAULT_AUTO_PAY_LIMIT_CENTS = 10000;

export const DEMO_DESCRIPTIONS: Record<string, string> = {
  "01-valido.png": "Remís para llevar el proyector y los banners al venue del meetup",
  "02-ambiguo.png": "Compras para el meetup",
  "03-duplicado.png": "Viaje al venue",
  "99-inyeccion.png": "Impresión de carteles para el meetup",
};

export const DEMO_CLARIFICATION_02 = "Fueron fibrones, cinta y cartulinas para la señalética";

/** Recomendación esperada al presentar cada comprobante en orden (01, 02, 03, 99). */
export const DEMO_EXPECTED: Record<string, string> = {
  "01-valido.png": "approve",
  "02-ambiguo.png": "needs_info",
  "03-duplicado.png": "flag_review",
  "99-inyeccion.png": "flag_review",
};
