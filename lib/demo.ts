// Política de la demo (PLAN.md §10).
import type { GeneralPolicy } from "./types.ts";

/** Política general de la demo: tope por ticket y presupuesto total (saldo de la wallet del agente). */
export const DEMO_POLICY: Omit<GeneralPolicy, "version"> = {
  name: "Meetup Stable Agents BA",
  capPerReceiptCents: 200000,
  budgetCents: 500000,
};

/** Presupuesto de la demo: el evento con sus fechas, con pago automático hasta $ 100 por ticket. */
export const DEMO_BUDGET = {
  name: "Meetup Stable Agents BA",
  startsOn: "2026-10-10",
  endsOn: "2026-10-18",
  autopayMaxCents: 10000,
};

export const DEMO_CATEGORIES = [
  { key: "transporte", name: "Transporte", description: "Remises, taxis, colectivos y viajes para el evento.", active: true },
  { key: "materiales", name: "Materiales", description: "Insumos para el evento: librería, impresiones, ferretería, señalética.", active: true },
];

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
