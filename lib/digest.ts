// Resumen del agente para el organizador: qué hay pendiente y qué necesita su atención.
// Determinista: sale del estado y la recomendación de cada solicitud, sin llamar a la IA.
import type { RequestRow } from "./types.ts";
import { formatArs } from "./money.ts";

/** Lo que el agente pagó solo en las últimas 24 h, para contarlo en el resumen. */
export interface AutoPayDay {
  count: number;
  cents: number;
  capCents: number;
  limitCents: number;
}

export interface DigestCounts {
  open: number;
  ready: number;
  review: number;
  duplicates: number;
  outside: number;
  waiting: number;
  analyzing: number;
  paying: number;
}

export interface Digest {
  counts: DigestCounts;
  /** Frase lista para mostrar, en primera persona del agente. */
  sentence: string;
  /** Lo más urgente para el organizador: 'ready' si hay algo para pagar, 'review' si algo necesita su ojo. */
  focus: "ready" | "review" | "idle";
}

function hasDuplicates(r: RequestRow): boolean {
  if (!r.duplicate_flags) return false;
  try {
    const d = JSON.parse(r.duplicate_flags) as { file?: number[]; data?: number[] };
    return Boolean(d.file?.length || d.data?.length);
  } catch {
    return false;
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const ars = (c: number) => formatArs(c).replace(",00", "");

function autoSentence(a: AutoPayDay | undefined): string {
  if (!a || a.limitCents <= 0) return "";
  const capped = a.capCents - a.cents < a.limitCents;
  if (a.count === 0) return capped ? "Hoy no puedo pagar solo: el tope de 24 h es menor que el límite por gasto. " : "";
  const did = `Hoy pagué solo ${plural(a.count, "gasto", "gastos")} (${ars(a.cents)} de ${ars(a.capCents)} del tope).`;
  return capped ? `${did} Llegué al tope: lo que sigue te espera. ` : `${did} `;
}

export function agentDigest(requests: RequestRow[], auto?: AutoPayDay): Digest {
  const c: DigestCounts = { open: 0, ready: 0, review: 0, duplicates: 0, outside: 0, waiting: 0, analyzing: 0, paying: 0 };
  for (const r of requests) {
    if (r.status === "reimbursed" || r.status === "rejected") continue;
    c.open++;
    switch (r.status) {
      case "submitted":
        c.analyzing++;
        break;
      case "needs_info":
        c.waiting++;
        break;
      case "authorized":
      case "paying":
        c.paying++;
        break;
      case "payment_uncertain":
      case "payment_failed":
        c.review++;
        break;
      case "analyzed":
        if (r.recommendation === "approve") c.ready++;
        else if (r.recommendation === "reject") c.outside++;
        else if (r.recommendation === "flag_review" && hasDuplicates(r)) c.duplicates++;
        else c.review++;
        break;
    }
  }

  const prefix = autoSentence(auto);
  if (c.open === 0) return { counts: c, sentence: `${prefix}Todo al día: no hay gastos pendientes.`, focus: "idle" };

  const parts: string[] = [];
  if (c.ready) parts.push(plural(c.ready, "listo para pagar", "listos para pagar"));
  if (c.review) parts.push(plural(c.review, "necesita tu ojo", "necesitan tu ojo"));
  if (c.duplicates) parts.push(plural(c.duplicates, "parece duplicado", "parecen duplicados"));
  if (c.outside) parts.push(plural(c.outside, "fuera de política", "fuera de política"));
  if (c.waiting) parts.push(plural(c.waiting, "espera respuesta del colaborador", "esperan respuesta del colaborador"));
  if (c.paying) parts.push(plural(c.paying, "pagándose", "pagándose"));
  if (c.analyzing) parts.push(plural(c.analyzing, "en análisis", "en análisis"));

  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} y ${parts.at(-1)}` : parts[0];
  const sentence = `${prefix}Revisé ${plural(c.open, "gasto abierto", "gastos abiertos")}: ${list}.`;
  const focus = c.review || c.duplicates || c.outside ? "review" : c.ready ? "ready" : "idle";
  return { counts: c, sentence, focus };
}
