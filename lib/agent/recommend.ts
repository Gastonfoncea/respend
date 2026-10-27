// Combinación determinista: salida de la IA + checks del código → recomendación final.
// Prioridad: reject (fuera de política) > flag_review (coincidencia sospechosa) > needs_info > approve.
import type { Check, Explanation, ReceiptFields, Recommendation } from "../types.ts";
import type { AiOutput } from "./prompt.ts";
import { tryParseArsToCents } from "../money.ts";
import { checkOf } from "../policy.ts";

export interface RecommendInput {
  ai: AiOutput | null;
  fields: ReceiptFields;
  checks: Check[];
  /** 'organizer' si el organizador corrigió los campos: el needs_info original de la IA queda superado. */
  fieldsSource: "ai" | "organizer";
}

export interface RecommendResult {
  recommendation: Recommendation;
  explanation: Explanation;
  /** Preguntas a publicar como aclaraciones del agente (solo si needs_info). */
  questions: string[];
}

export const FLAG_TEXT = "Coincidencia sospechosa: requiere revisión. No es prueba de fraude.";
export const REJECT_TEXT = "Fuera de política.";

/** Campos vigentes a partir de la salida de la IA. */
export function fieldsFromAi(ai: AiOutput): ReceiptFields {
  return {
    date: ai.extracted.date,
    merchant: ai.extracted.merchant,
    concept: ai.extracted.concept,
    amountCents: tryParseArsToCents(ai.extracted.amount),
    currency: ai.extracted.currency,
    category: ai.category,
  };
}

export function recommend(input: RecommendInput): RecommendResult {
  const { ai, fields, checks, fieldsSource } = input;
  const failed = (rule: Check["rule"]) => checkOf(checks, rule)?.ok === false;
  const evidence = ai?.evidence ?? [];
  const agentText = ai?.explanation ?? null;
  const done = (recommendation: Recommendation, summary: string, questions: string[] = []): RecommendResult => ({
    recommendation,
    explanation: { summary, agentText, rules: checks, evidence },
    questions,
  });

  // 1. Fuera de política.
  const rejectReasons: string[] = [];
  if (failed("amount_le_cap")) rejectReasons.push("el importe supera el tope por comprobante");
  if (fields.category === "otra") rejectReasons.push("la categoría no está permitida");
  else if (failed("category_allowed")) rejectReasons.push("la categoría no está permitida");
  if (failed("date_in_range")) rejectReasons.push("la fecha está fuera del evento");
  if (failed("currency_is_ars")) rejectReasons.push("la moneda no es ARS");
  if (rejectReasons.length) {
    return done("reject", `${REJECT_TEXT} Motivo: ${rejectReasons.join("; ")}. El organizador puede pedir una aclaración.`);
  }

  // 2. Coincidencias sospechosas y alertas que requieren mirada humana. Tiene prioridad sobre approve.
  const flagReasons: string[] = [];
  if (failed("duplicate_file")) flagReasons.push("el archivo es idéntico al de otra solicitud");
  if (failed("duplicate_data")) flagReasons.push("coincide comercio, fecha e importe con otra solicitud");
  if (ai && ai.suspicious_instructions.length) flagReasons.push("el comprobante o la descripción contienen instrucciones dirigidas al agente");
  if (flagReasons.length) {
    return done("flag_review", `${FLAG_TEXT} Motivo: ${flagReasons.join("; ")}.`);
  }
  const otherReview: string[] = [];
  if (failed("budget_available")) otherReview.push("no alcanza el presupuesto disponible");
  if (failed("recipient_valid")) otherReview.push("la wallet de destino no es válida");
  if (failed("assignment_found")) otherReview.push("no tiene presupuesto asignado para esto");
  if (failed("budget_window")) otherReview.push("el presupuesto está cerrado");
  if (ai && ai.recommendation === "reject" && fieldsSource === "ai") otherReview.push("el agente sugirió rechazar");
  if (otherReview.length) {
    return done("flag_review", `Requiere revisión del organizador: ${otherReview.join("; ")}.`);
  }

  // 3. Falta información.
  const missing: string[] = [];
  if (fields.date == null) missing.push("fecha");
  if (fields.amountCents == null) missing.push("importe");
  if (fields.currency == null) missing.push("moneda");
  if (fields.merchant == null) missing.push("comercio");
  if (fields.concept == null) missing.push("concepto");
  if (fields.category == null || fields.category === "indeterminada") missing.push("categoría");
  const aiNeedsInfo = !!ai && ai.recommendation === "needs_info" && fieldsSource === "ai";
  if (!ai && fieldsSource === "ai") missing.push("análisis del agente");
  if (aiNeedsInfo || missing.length) {
    let questions = fieldsSource === "ai" && ai ? ai.clarification_questions.slice(0, 3) : [];
    if (!questions.length && missing.length) {
      questions = [`¿Podés aclarar: ${missing.join(", ")}?`];
    }
    const what = missing.length ? ` Falta: ${missing.join(", ")}.` : "";
    return done("needs_info", `Falta información para decidir.${what}`, questions);
  }

  // 4. Aprobar: la IA aprobó (o el organizador corrigió los datos) y todos los checks pasan.
  const allPass = checks.every((c) => c.ok === true);
  const aiApproves = fieldsSource === "organizer" || ai?.recommendation === "approve";
  if (allPass && aiApproves) {
    return done("approve", "Cumple la política: se recomienda aprobar. La decisión final es del organizador.");
  }
  return done("needs_info", "No se pudo verificar todo lo necesario para recomendar aprobar.", [
    "¿Podés agregar más detalle sobre el gasto?",
  ]);
}
