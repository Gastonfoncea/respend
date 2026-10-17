// Casos de uso de una solicitud. Cada función que representa una acción humana recibe la sesión
// y verifica el rol (assertRole). Las server actions solo leen la sesión y llaman acá.
import fs from "node:fs";
import path from "node:path";
import type { DB } from "./db.ts";
import { tx } from "./db.ts";
import * as repo from "./repo.ts";
import { assertRole, actorName } from "./auth.ts";
import { ALLOWED_MIME, MAX_RECEIPT_BYTES } from "./config.ts";
import { sha256Hex, findDuplicates } from "./duplicates.ts";
import { getBudget } from "./budget.ts";
import { evaluateChecks, isIsoDate, normalizeRecipient } from "./policy.ts";
import { recommend, fieldsFromAi } from "./agent/recommend.ts";
import { validateAiOutput, type AiOutput } from "./agent/prompt.ts";
import type { Analyzer } from "./agent/analyze.ts";
import { bindingFor, bindingHash } from "./binding.ts";
import { parseArsToCents, assertCents, formatArs } from "./money.ts";
import type { Check, Policy, ReceiptFields, RequestRow, RequestStatus, Session } from "./types.ts";

export class WorkflowError extends Error {}

export interface Ctx {
  db: DB;
  receiptsDir: string;
  analyzer: Analyzer;
}

function mustGet(db: DB, id: number): RequestRow {
  const r = repo.getRequest(db, id);
  if (!r) throw new WorkflowError(`No existe la solicitud #${id}`);
  return r;
}

function assertStatus(r: RequestRow, allowed: RequestStatus[], what: string): void {
  if (!allowed.includes(r.status)) throw new WorkflowError(`No se puede ${what} una solicitud en estado "${r.status}".`);
}

export function currentFields(r: RequestRow): ReceiptFields {
  return {
    date: r.receipt_date,
    merchant: r.merchant,
    concept: r.concept,
    amountCents: r.amount_cents,
    currency: r.currency,
    category: r.category,
  };
}

export function sniffMime(bytes: Uint8Array): string | null {
  const b = Buffer.from(bytes.subarray(0, 12));
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

/** Categorías que entiende el schema del agente (lib/agent/prompt.ts). */
export const KNOWN_CATEGORIES = ["transporte", "materiales"] as const;

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

// --- política ---

export function updatePolicy(ctx: Ctx, session: Session | null, p: Omit<Policy, "version">): void {
  const s = assertRole(session, ["organizer"]);
  if (!p.name.trim()) throw new WorkflowError("El evento necesita un nombre.");
  if (!isIsoDate(p.startDate) || !isIsoDate(p.endDate) || p.startDate > p.endDate) throw new WorkflowError("Fechas inválidas.");
  if (!p.categories.length) throw new WorkflowError("Tiene que haber al menos una categoría.");
  const unknown = p.categories.filter((c) => !(KNOWN_CATEGORIES as readonly string[]).includes(c));
  if (unknown.length) throw new WorkflowError(`Categorías no soportadas por el agente: ${unknown.join(", ")}.`);
  assertCents(p.capPerReceiptCents);
  assertCents(p.budgetCents);
  tx(ctx.db, () => {
    if (repo.countRequests(ctx.db) > 0) {
      throw new WorkflowError("La política quedó bloqueada porque ya hay solicitudes presentadas.");
    }
    repo.upsertEvent(ctx.db, p);
    repo.audit(ctx.db, null, actorName(s), "policy_updated", p);
  });
}

// --- wallet de cobro del colaborador ---

/** Nombre visible del colaborador: sin caracteres de control, espacios colapsados, 2 a 60 caracteres. */
export function normalizeClaimantName(raw: string): string | null {
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  return name.length >= 2 && name.length <= 60 ? name : null;
}

/**
 * El colaborador define quién es (nombre declarado) y a qué wallet le pagan. Las solicitudes ya presentadas
 * conservan el nombre y la wallet que tenían (el organizador aprobó ese destinatario exacto);
 * lo nuevo aplica a los gastos que presente después.
 */
export function setCollaboratorProfile(ctx: Ctx, session: Session | null, input: { name: string; wallet: string }): repo.CollaboratorProfile {
  const s = assertRole(session, ["collaborator"]);
  const name = normalizeClaimantName(input.name);
  if (!name) throw new WorkflowError("Escribí tu nombre (entre 2 y 60 caracteres).");
  const wallet = normalizeRecipient(input.wallet);
  if (!wallet) throw new WorkflowError("Esa no es una dirección válida (0x… de 40 caracteres hex).");
  return tx(ctx.db, () => {
    const before = repo.getCollaboratorProfile(ctx.db);
    if (before?.name !== name || before?.wallet !== wallet) {
      repo.setCollaboratorProfile(ctx.db, { name, wallet });
      repo.audit(ctx.db, null, actorName(s), "collaborator_profile_updated", { before, after: { name, wallet } });
    }
    return { name, wallet };
  });
}

// --- presentar ---

export interface SubmitInput {
  description: string;
  recipient: string;
  file: { bytes: Uint8Array; mime: string };
}

export function submitExpense(ctx: Ctx, session: Session | null, input: SubmitInput): number {
  const s = assertRole(session, ["collaborator"]);
  repo.getPolicy(ctx.db); // tira si no hay evento
  const description = input.description.trim();
  if (!description) throw new WorkflowError("Escribí una descripción breve del gasto.");
  if (description.length > 1000) throw new WorkflowError("La descripción es demasiado larga (máx. 1000 caracteres).");
  const recipient = normalizeRecipient(input.recipient);
  if (!recipient) throw new WorkflowError("La wallet de destino no es una dirección válida (0x… de 40 caracteres hex).");
  // Si el colaborador configuró su wallet de cobro, el destinatario tiene que ser esa: no se acepta otra.
  const profile = repo.getCollaboratorProfile(ctx.db);
  const profileWallet = profile?.wallet ?? null;
  if (profileWallet && profileWallet !== recipient) {
    throw new WorkflowError("La wallet de cobro tiene que ser la de tu perfil. Cambiala desde \"Mi wallet\".");
  }
  const { bytes } = input.file;
  if (!bytes.length) throw new WorkflowError("Falta la imagen del comprobante.");
  if (bytes.length > MAX_RECEIPT_BYTES) throw new WorkflowError("La imagen supera los 4 MB.");
  const sniffed = sniffMime(bytes);
  if (!sniffed || !(ALLOWED_MIME as readonly string[]).includes(sniffed)) {
    throw new WorkflowError("La imagen tiene que ser JPEG, PNG o WebP.");
  }

  const sha = sha256Hex(bytes);
  fs.mkdirSync(ctx.receiptsDir, { recursive: true });
  const fileName = `${sha}.${EXT[sniffed]}`;
  const full = path.join(/*turbopackIgnore: true*/ ctx.receiptsDir, fileName);
  if (!fs.existsSync(/*turbopackIgnore: true*/ full)) fs.writeFileSync(full, bytes, { mode: 0o600 });

  return tx(ctx.db, () => {
    const claimantName = profile?.name ?? null;
    const id = repo.insertRequest(ctx.db, { description, recipient, claimantName, filePath: fileName, fileSha256: sha, mime: sniffed });
    repo.audit(ctx.db, id, actorName(s), "submitted", { file_sha256: sha, recipient, claimant_name: claimantName });
    return id;
  });
}

export function readReceipt(ctx: Ctx, r: RequestRow): Buffer {
  const full = path.join(ctx.receiptsDir, path.basename(r.file_path));
  return fs.readFileSync(full);
}

// --- análisis ---

/**
 * Recalcula checks deterministas + recomendación con los campos vigentes. No llama a la IA.
 * Tiene que correr dentro de tx().
 */
function reevaluate(db: DB, r: RequestRow, ai: AiOutput | null, fields: ReceiptFields, fieldsSource: "ai" | "organizer") {
  const policy = repo.getPolicy(db);
  const budget = getBudget(db);
  const ownAuth = repo.getActiveAuthorization(db, r.id);
  const duplicates = findDuplicates(db, r.id, r.file_sha256, fields);
  const checks = evaluateChecks({
    policy,
    fields,
    recipient: r.recipient,
    availableForRequestCents: budget.availableCents + (ownAuth?.amount_cents ?? 0),
    duplicates,
  });
  const result = recommend({ ai, fields, checks, fieldsSource });
  repo.updateRequest(db, r.id, {
    receipt_date: fields.date,
    merchant: fields.merchant,
    concept: fields.concept,
    amount_cents: fields.amountCents,
    currency: fields.currency,
    category: fields.category,
    fields_source: fieldsSource,
    checks: JSON.stringify(checks),
    duplicate_flags: JSON.stringify(duplicates),
    recommendation: result.recommendation,
    explanation: JSON.stringify(result.explanation),
    policy_version: policy.version,
  });
  return result;
}

/**
 * Corre el agente sobre una solicitud en estado "submitted". Lo invoca el sistema después de presentar
 * o de que el colaborador responda; la acción que lo dispara ya verificó el rol.
 */
export async function analyzeRequest(ctx: Ctx, requestId: number): Promise<RequestRow> {
  const r = mustGet(ctx.db, requestId);
  assertStatus(r, ["submitted"], "analizar");
  const policy = repo.getPolicy(ctx.db);
  const clarifications = repo.listClarifications(ctx.db, requestId);
  const image = readReceipt(ctx, r);

  const res = await ctx.analyzer({
    image,
    mime: r.mime,
    fileSha256: r.file_sha256,
    description: r.description,
    clarifications,
    policy,
  });

  tx(ctx.db, () => {
    const now = mustGet(ctx.db, requestId);
    if (now.status !== "submitted") throw new WorkflowError("La solicitud cambió mientras se analizaba.");
    if (!res.ok) {
      repo.updateRequest(ctx.db, requestId, { ai_error: res.error, ai_model: res.model, ai_provider: res.provider });
      repo.audit(ctx.db, requestId, "agente", "analysis_failed", { error: res.error, model: res.model });
      return;
    }
    repo.updateRequest(ctx.db, requestId, {
      ai_output: JSON.stringify(res.output),
      ai_model: res.model,
      ai_provider: res.provider,
      ai_ran_at: new Date().toISOString(),
      ai_error: null,
      ai_fake: res.fake ? 1 : 0,
    });
    const result = reevaluate(ctx.db, now, res.output, fieldsFromAi(res.output), "ai");
    if (result.recommendation === "needs_info") {
      for (const q of result.questions) repo.addClarification(ctx.db, requestId, "agent", q);
      repo.setStatus(ctx.db, requestId, "needs_info");
    } else {
      repo.setStatus(ctx.db, requestId, "analyzed");
    }
    repo.audit(ctx.db, requestId, "agente", "analyzed", {
      model: res.model,
      provider: res.provider,
      fake: res.fake,
      recommendation: result.recommendation,
      suspicious_instructions: res.output.suspicious_instructions,
    });
  });
  return mustGet(ctx.db, requestId);
}

export function aiOutputOf(r: RequestRow): AiOutput | null {
  if (!r.ai_output) return null;
  try {
    return validateAiOutput(JSON.parse(r.ai_output));
  } catch {
    return null;
  }
}

// --- aclaraciones ---

export function respondClarification(ctx: Ctx, session: Session | null, requestId: number, message: string): void {
  const s = assertRole(session, ["collaborator"]);
  const msg = message.trim();
  if (!msg) throw new WorkflowError("Escribí una respuesta.");
  if (msg.length > 1000) throw new WorkflowError("La respuesta es demasiado larga (máx. 1000 caracteres).");
  tx(ctx.db, () => {
    const r = mustGet(ctx.db, requestId);
    assertStatus(r, ["needs_info"], "responder");
    repo.addClarification(ctx.db, requestId, "collaborator", msg);
    repo.setStatus(ctx.db, requestId, "submitted");
    repo.audit(ctx.db, requestId, actorName(s), "clarification_answered", { message: msg });
  });
}

export function requestClarification(ctx: Ctx, session: Session | null, requestId: number, message: string): void {
  const s = assertRole(session, ["organizer"]);
  const msg = message.trim();
  if (!msg) throw new WorkflowError("Escribí qué necesitás saber.");
  tx(ctx.db, () => {
    const r = mustGet(ctx.db, requestId);
    assertStatus(r, ["analyzed", "needs_info"], "pedir aclaración sobre");
    repo.addClarification(ctx.db, requestId, "organizer", msg.slice(0, 1000));
    repo.setStatus(ctx.db, requestId, "needs_info");
    repo.audit(ctx.db, requestId, actorName(s), "clarification_requested", { message: msg });
  });
}

/** Reintento manual del análisis cuando falló (por ejemplo, faltaba la key). */
export function canRetryAnalysis(r: RequestRow): boolean {
  return r.status === "submitted";
}

// --- correcciones del organizador ---

export interface CorrectionInput {
  date: string | null;
  merchant: string | null;
  concept: string | null;
  amount: string | null; // "1.500,00" o "1500.00"
  currency: string | null;
  category: string | null;
}

export function correctFields(ctx: Ctx, session: Session | null, requestId: number, input: CorrectionInput): void {
  const s = assertRole(session, ["organizer"]);
  const clean = (v: string | null) => (v && v.trim() ? v.trim().slice(0, 200) : null);
  const date = clean(input.date);
  if (date && !isIsoDate(date)) throw new WorkflowError("Fecha inválida (usá AAAA-MM-DD).");
  const amountStr = clean(input.amount);
  let amountCents: number | null = null;
  if (amountStr) {
    try {
      amountCents = parseArsToCents(amountStr);
    } catch (err) {
      throw new WorkflowError((err as Error).message);
    }
  }
  const fields: ReceiptFields = {
    date,
    merchant: clean(input.merchant),
    concept: clean(input.concept),
    amountCents,
    currency: clean(input.currency)?.toUpperCase() ?? null,
    category: clean(input.category),
  };
  tx(ctx.db, () => {
    const r = mustGet(ctx.db, requestId);
    assertStatus(r, ["analyzed", "needs_info", "authorized"], "corregir");
    const auth = repo.getActiveAuthorization(ctx.db, requestId);
    if (auth) {
      repo.revokeAuthorization(ctx.db, auth.id, "El organizador corrigió los datos de la solicitud.");
      repo.audit(ctx.db, requestId, actorName(s), "authorization_revoked", { authorization_id: auth.id, reason: "fields_corrected" });
    }
    const before = currentFields(r);
    const result = reevaluate(ctx.db, r, aiOutputOf(r), fields, "organizer");
    repo.setStatus(ctx.db, requestId, "analyzed");
    repo.audit(ctx.db, requestId, actorName(s), "fields_corrected", { before, after: fields, recommendation: result.recommendation });
  });
}

// --- rechazar ---

export function rejectRequest(ctx: Ctx, session: Session | null, requestId: number, reason: string): void {
  const s = assertRole(session, ["organizer"]);
  tx(ctx.db, () => {
    const r = mustGet(ctx.db, requestId);
    assertStatus(r, ["submitted", "analyzed", "needs_info", "authorized", "payment_failed"], "rechazar");
    const auth = repo.getActiveAuthorization(ctx.db, requestId);
    if (auth) repo.revokeAuthorization(ctx.db, auth.id, "Solicitud rechazada.");
    repo.setStatus(ctx.db, requestId, "rejected");
    repo.audit(ctx.db, requestId, actorName(s), "rejected", { reason: reason.trim().slice(0, 1000) || null });
  });
}

// --- autorizar ---

export interface AuthorizeInput {
  /** Checkbox "Verifiqué monto y destinatario". */
  verifiedAmountAndRecipient: boolean;
  /** Checkbox "Revisé las alertas" (obligatorio si la recomendación es flag_review o needs_info). */
  reviewedAlerts: boolean;
  reason: string;
}

export function authorize(ctx: Ctx, session: Session | null, requestId: number, input: AuthorizeInput): number {
  const s = assertRole(session, ["organizer"]);
  if (!input.verifiedAmountAndRecipient) throw new WorkflowError("Tildá \"Verifiqué monto y destinatario\".");
  return tx(ctx.db, () => {
    const r = mustGet(ctx.db, requestId);
    assertStatus(r, ["analyzed", "needs_info", "payment_failed"], "autorizar");
    if (repo.getActiveAuthorization(ctx.db, requestId)) throw new WorkflowError("Ya hay una autorización activa.");
    if (!r.recommendation) throw new WorkflowError("La solicitud todavía no fue analizada.");
    if (r.recommendation === "reject") throw new WorkflowError("La recomendación es rechazar (fuera de política): no se puede autorizar.");
    const reason = input.reason.trim();
    if (r.recommendation === "flag_review" || r.recommendation === "needs_info") {
      if (!input.reviewedAlerts || !reason) {
        throw new WorkflowError("Hay alertas: tildá \"Revisé las alertas\" y escribí el motivo para autorizar igual.");
      }
    }
    const policy = repo.getPolicy(ctx.db);
    const blocked = hardLimitError(ctx.db, r, policy);
    if (blocked) throw new WorkflowError(blocked);
    const { id, hash } = insertAuthorization(ctx.db, r, policy, actorName(s), reason || null);
    repo.setStatus(ctx.db, r.id, "authorized");
    repo.audit(ctx.db, r.id, actorName(s), "authorized", {
      authorization_id: id,
      binding_hash: hash,
      recommendation: r.recommendation,
      reviewed_alerts: input.reviewedAlerts,
      reason: reason || null,
    });
    return id;
  });
}

/** Límites duros (no se pasan ni con motivo). Devuelve el motivo del bloqueo o null si se puede autorizar. */
function hardLimitError(db: DB, r: RequestRow, policy: Policy): string | null {
  if (r.amount_cents == null) return "Falta el importe.";
  if (r.amount_cents <= 0) return "El importe tiene que ser mayor a cero.";
  if (r.amount_cents > policy.capPerReceiptCents) return "El importe supera el tope por comprobante.";
  if (r.amount_cents > getBudget(db).availableCents) return "No alcanza el presupuesto disponible.";
  if (!normalizeRecipient(r.recipient)) return "La wallet de destino no es válida.";
  return null;
}

function insertAuthorization(db: DB, r: RequestRow, policy: Policy, by: string, note: string | null): { id: number; hash: string } {
  const b = bindingFor(r, policy.version);
  const hash = bindingHash(b);
  const id = repo.insertAuthorization(db, {
    request_id: r.id,
    amount_cents: b.amount_cents,
    token_amount: b.token_amount,
    token_address: b.token_address,
    chain_id: b.chain_id,
    recipient: b.recipient,
    binding_hash: hash,
    policy_version: b.policy_version,
    authorized_by: by,
    review_note: note,
  });
  return { id, hash };
}

// --- pago automático ---

/** El organizador fija hasta cuánto (inclusive) el agente paga solo. 0 lo apaga. */
export function setAutoPayLimit(ctx: Ctx, session: Session | null, cents: number): void {
  const s = assertRole(session, ["organizer"]);
  if (!Number.isSafeInteger(cents) || cents < 0) throw new WorkflowError("El límite tiene que ser un monto válido, 0 o más.");
  const policy = repo.getPolicy(ctx.db);
  if (cents > policy.capPerReceiptCents) throw new WorkflowError("El límite automático no puede superar el tope por comprobante.");
  tx(ctx.db, () => {
    const before = repo.getAutoPayLimitCents(ctx.db);
    if (before === cents) return;
    repo.setAutoPayLimitCents(ctx.db, cents);
    repo.audit(ctx.db, null, actorName(s), "auto_pay_limit_updated", { before_cents: before, after_cents: cents });
  });
}

/**
 * Autorización automática, sin intervención humana en el momento. La decide el código, nunca la IA:
 * solo si la recomendación es "approve" (todos los checks pasan, sin alertas ni duplicados), el monto
 * es menor o igual al límite que fijó el organizador y se cumplen los límites duros.
 * Devuelve el id de la autorización, o null si la solicitud tiene que ir al organizador.
 */
export function autoAuthorize(ctx: Ctx, requestId: number): number | null {
  return tx(ctx.db, () => {
    const r = mustGet(ctx.db, requestId);
    if (r.status !== "analyzed" || r.recommendation !== "approve") return null;
    if (repo.getActiveAuthorization(ctx.db, requestId)) return null;
    const limit = repo.getAutoPayLimitCents(ctx.db);
    if (limit <= 0 || r.amount_cents == null || r.amount_cents > limit) return null;
    const policy = repo.getPolicy(ctx.db);
    if (hardLimitError(ctx.db, r, policy)) return null;
    const { id, hash } = insertAuthorization(ctx.db, r, policy, `${repo.AUTO_PAY_ACTOR} ≤ ${formatArs(limit)}`, null);
    repo.setStatus(ctx.db, r.id, "authorized");
    repo.audit(ctx.db, r.id, "agente", "auto_authorized", {
      authorization_id: id,
      binding_hash: hash,
      amount_cents: r.amount_cents,
      limit_cents: limit,
    });
    return id;
  });
}

// --- vista previa del agente (antes de enviar) ---

export type PreviewVerdict = "fits" | "outside" | "unclear" | "review";

export type PreviewResult =
  | {
      ok: true;
      fields: ReceiptFields;
      categoryReasoning: string;
      verdict: PreviewVerdict;
      headline: string;
      /** Reglas que el colaborador puede entender antes de enviar (sin la wallet: esa sale del perfil). */
      checks: Check[];
      duplicateOf: number[];
      suspicious: string[];
      /** Una sola pregunta: para qué fue el gasto (o lo que el agente necesite saber). */
      question: string;
      agentText: string | null;
      fake: boolean;
    }
  | { ok: false; error: string };

const PREVIEW_RULES: Check["rule"][] = [
  "date_in_range",
  "currency_is_ars",
  "amount_parsed",
  "amount_le_cap",
  "category_allowed",
  "budget_available",
  "duplicate_file",
  "duplicate_data",
];

/**
 * El agente lee el ticket ANTES de que el colaborador lo envíe. No guarda nada (ni archivo ni solicitud):
 * es solo una ayuda para evitar rechazos. La evaluación que vale es la que corre al enviar.
 */
export async function previewExpense(ctx: Ctx, session: Session | null, file: { bytes: Uint8Array }): Promise<PreviewResult> {
  assertRole(session, ["collaborator"]);
  const { bytes } = file;
  if (!bytes.length) throw new WorkflowError("Falta la imagen del comprobante.");
  if (bytes.length > MAX_RECEIPT_BYTES) throw new WorkflowError("La imagen supera los 4 MB.");
  const mime = sniffMime(bytes);
  if (!mime || !(ALLOWED_MIME as readonly string[]).includes(mime)) throw new WorkflowError("La imagen tiene que ser JPEG, PNG o WebP.");

  const policy = repo.getPolicy(ctx.db);
  const sha = sha256Hex(bytes);
  const res = await ctx.analyzer({ image: Buffer.from(bytes), mime, fileSha256: sha, description: "", clarifications: [], policy });
  if (!res.ok) return { ok: false, error: res.error };

  const ai = res.output;
  const fields = fieldsFromAi(ai);
  const duplicates = findDuplicates(ctx.db, -1, sha, fields);
  const all = evaluateChecks({
    policy,
    fields,
    recipient: "",
    availableForRequestCents: getBudget(ctx.db).availableCents,
    duplicates,
  });
  const checks = all.filter((c) => PREVIEW_RULES.includes(c.rule));
  const failed = (rule: Check["rule"]) => checks.find((c) => c.rule === rule)?.ok === false;
  const unknown = (rule: Check["rule"]) => checks.find((c) => c.rule === rule)?.ok == null;
  const duplicateOf = [...new Set([...duplicates.file, ...duplicates.data])];
  const suspicious = ai.suspicious_instructions;
  const cat = fields.category;

  let verdict: PreviewVerdict;
  let headline: string;
  if (duplicateOf.length) {
    verdict = "review";
    headline = `Parece el mismo ticket que ya presentaste (#${duplicateOf.join(", #")}).`;
  } else if (suspicious.length) {
    verdict = "review";
    headline = "El ticket trae texto que parece una instrucción. Lo ignoré, pero el organizador lo va a revisar.";
  } else if (failed("category_allowed")) {
    verdict = "outside";
    headline = `Esto no parece ${policy.categories.join(" ni ")}: probablemente no se reembolse.`;
  } else if (failed("date_in_range")) {
    verdict = "outside";
    headline = `La fecha del ticket está fuera del evento (${policy.startDate} a ${policy.endDate}).`;
  } else if (failed("amount_le_cap")) {
    verdict = "outside";
    headline = "El monto supera el tope por ticket.";
  } else if (failed("currency_is_ars")) {
    verdict = "outside";
    headline = "El ticket no está en pesos argentinos.";
  } else if (failed("budget_available")) {
    verdict = "outside";
    headline = "No queda presupuesto suficiente en el evento para este monto.";
  } else if (unknown("amount_parsed") || unknown("date_in_range") || unknown("category_allowed")) {
    verdict = "unclear";
    headline = unknown("amount_parsed")
      ? "No pude leer bien el monto."
      : unknown("date_in_range")
        ? "No pude leer bien la fecha."
        : "No me queda claro qué se compró.";
  } else {
    verdict = "fits";
    headline = `Entra en ${cat}.`;
  }

  const question =
    cat === "indeterminada" && ai.clarification_questions[0] ? ai.clarification_questions[0] : "¿Para qué fue este gasto?";

  return {
    ok: true,
    fields,
    categoryReasoning: ai.category_reasoning,
    verdict,
    headline,
    checks,
    duplicateOf,
    suspicious,
    question,
    agentText: ai.explanation || null,
    fake: res.fake,
  };
}
