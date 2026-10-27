// Casos de uso de una solicitud. Cada función que representa una acción humana recibe la sesión
// y verifica el rol (assertRole). Las server actions solo leen la sesión y llaman acá.
import type { DB, Queryable } from "./db.ts";
import { tx } from "./db.ts";
import type { ReceiptStore } from "./receipts.ts";
import * as repo from "./repo.ts";
import { assertRole, actorName } from "./auth.ts";
import { ALLOWED_MIME, MAX_RECEIPT_BYTES } from "./config.ts";
import { sha256Hex, findDuplicates } from "./duplicates.ts";
import { getBudget } from "./budget.ts";
import { evaluateChecks, isIsoDate, normalizeRecipient, unsafeRecipientReason } from "./policy.ts";
import type { PaymentMode } from "./config.ts";
import { recommend, fieldsFromAi } from "./agent/recommend.ts";
import { validateAiOutput, type AiOutput } from "./agent/prompt.ts";
import type { Analyzer } from "./agent/analyze.ts";
import { bindingFor, bindingHash } from "./binding.ts";
import { parseArsToCents, assertCents, formatArs } from "./money.ts";
import * as budgets from "./budgets.ts";
import type { AssignmentBalance, AuthorizationMode, Check, GeneralPolicy, Policy, ReceiptFields, RequestRow, RequestStatus, Session } from "./types.ts";

export class WorkflowError extends Error {}

export interface Ctx {
  db: DB;
  receipts: ReceiptStore;
  analyzer: Analyzer;
  /** Modo de pago de la app. En mainnet el pago automático no corre sobre análisis de prueba. */
  paymentMode?: PaymentMode;
}

async function mustGet(q: Queryable, id: number): Promise<RequestRow> {
  const r = await repo.getRequest(q, id);
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

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

// --- política ---

/** Política general: nombre, tope por ticket y presupuesto total. Las fechas y categorías van por presupuesto. */
export async function updatePolicy(ctx: Ctx, session: Session | null, p: Omit<GeneralPolicy, "version">): Promise<void> {
  const s = assertRole(session, ["organizer"]);
  if (!p.name.trim()) throw new WorkflowError("La organización necesita un nombre.");
  assertCents(p.capPerReceiptCents);
  assertCents(p.budgetCents);
  await tx(ctx.db, async (q) => {
    if ((await repo.countRequests(q)) > 0) {
      throw new WorkflowError("La política quedó bloqueada porque ya hay solicitudes presentadas.");
    }
    await repo.upsertEvent(q, p);
    await repo.audit(q, null, actorName(s), "policy_updated", p);
  });
}

// --- acceso a una solicitud ---

/** El organizador ve todo; el colaborador, solo lo que presentó él. */
export function canSeeRequest(session: Session, r: RequestRow): boolean {
  return session.role === "organizer" || (r.member_id != null && r.member_id === session.memberId);
}

/** Para páginas y rutas: la solicitud si existe y la sesión puede verla; si no, null (se responde "no encontrado"). */
export async function requestFor(ctx: Ctx, session: Session, id: number): Promise<RequestRow | null> {
  const r = await repo.getRequest(ctx.db, id);
  return r && canSeeRequest(session, r) ? r : null;
}

/** Las solicitudes que esa sesión puede ver. */
export function visibleRequests(ctx: Ctx, session: Session): Promise<RequestRow[]> {
  return session.role === "organizer" ? repo.listRequests(ctx.db) : repo.listRequestsByMember(ctx.db, session.memberId);
}

// --- presentar ---

export interface SubmitInput {
  description: string;
  /** Presupuesto al que se presenta. Si no viene, el abierto más reciente donde la persona tiene asignación. */
  budgetId?: number | null;
  /** Opcional: si viene, tiene que ser la wallet del perfil. El destino sale siempre del perfil del miembro. */
  recipient?: string;
  file: { bytes: Uint8Array; mime: string };
}

export async function submitExpense(ctx: Ctx, session: Session | null, input: SubmitInput): Promise<number> {
  const s = assertRole(session, ["collaborator"]);
  await repo.getPolicy(ctx.db); // tira si no hay evento
  const description = input.description.trim();
  if (!description) throw new WorkflowError("Escribí una descripción breve del gasto.");
  if (description.length > 1000) throw new WorkflowError("La descripción es demasiado larga (máx. 1000 caracteres).");
  // El destino es siempre la wallet que el organizador fijó para esta persona.
  const member = await repo.getMember(ctx.db, s.memberId);
  if (!member?.active) throw new WorkflowError("Tu acceso está desactivado.");
  if (!member.wallet) throw new WorkflowError("Todavía no tenés wallet de cobro. Pedile al organizador que la cargue en \"Equipo\".");
  const recipient = normalizeRecipient(member.wallet);
  if (!recipient) throw new WorkflowError("La wallet de tu perfil no es válida. Pedile al organizador que la corrija.");
  const unsafe = unsafeRecipientReason(recipient);
  if (unsafe) throw new WorkflowError(unsafe);
  if (input.recipient !== undefined && normalizeRecipient(input.recipient) !== recipient) {
    throw new WorkflowError("La wallet de cobro tiene que ser la de tu perfil.");
  }
  const budget = await pickBudget(ctx.db, member.id, input.budgetId ?? null);
  const { bytes } = input.file;
  if (!bytes.length) throw new WorkflowError("Falta la imagen del comprobante.");
  if (bytes.length > MAX_RECEIPT_BYTES) throw new WorkflowError("La imagen supera los 4 MB.");
  const sniffed = sniffMime(bytes);
  if (!sniffed || !(ALLOWED_MIME as readonly string[]).includes(sniffed)) {
    throw new WorkflowError("La imagen tiene que ser JPEG, PNG o WebP.");
  }

  const sha = sha256Hex(bytes);
  const fileName = `${sha}.${EXT[sniffed]}`;
  // El archivo se guarda antes de crear la solicitud: si falla, no queda una solicitud sin comprobante.
  await ctx.receipts.put(fileName, bytes, sniffed);

  return tx(ctx.db, async (q) => {
    const claimantName = member.name;
    const id = await repo.insertRequest(q, {
      description,
      recipient,
      claimantName,
      memberId: member.id,
      budgetId: budget.id,
      filePath: fileName,
      fileSha256: sha,
      mime: sniffed,
    });
    await repo.audit(q, id, actorName(s), "submitted", { file_sha256: sha, recipient, claimant_name: claimantName, member_id: member.id, budget_id: budget.id });
    return id;
  });
}

/** El presupuesto elegido (tiene que estar abierto y la persona tener una asignación) o el abierto más reciente. */
async function pickBudget(q: Queryable, memberId: number, budgetId: number | null) {
  const open = await budgets.openBudgetsOfMember(q, memberId);
  if (!open.length) throw new WorkflowError("No tenés presupuesto asignado. Pedile al organizador que te asigne uno.");
  if (budgetId == null) return open[0];
  const b = open.find((x) => x.id === budgetId);
  if (!b) throw new WorkflowError("Ese presupuesto no está abierto o no tenés asignación en él.");
  return b;
}

export function readReceipt(ctx: Ctx, r: RequestRow): Promise<Buffer> {
  return ctx.receipts.get(r.file_path);
}

// --- análisis ---

/**
 * Recalcula checks deterministas + recomendación con los campos vigentes. No llama a la IA.
 * Tiene que correr dentro de tx().
 */
async function reevaluate(q: Queryable, r: RequestRow, ai: AiOutput | null, fields: ReceiptFields, fieldsSource: "ai" | "organizer") {
  const policy = await budgets.policyFor(q, r.budget_id);
  const budget = await getBudget(q);
  const ownAuth = await repo.getActiveAuthorization(q, r.id);
  const duplicates = await findDuplicates(q, r.id, r.file_sha256, fields);
  const checks = evaluateChecks({
    policy,
    fields,
    recipient: r.recipient,
    availableForRequestCents: budget.availableCents + (ownAuth?.amount_cents ?? 0),
    duplicates,
  });
  // Presupuesto de la persona: abierto, y una asignación para la categoría (o una sin categoría).
  let assignmentId: number | null = null;
  if (r.budget_id != null && r.member_id != null) {
    const b = await budgets.getBudgetById(q, r.budget_id);
    checks.push({
      rule: "budget_window",
      ok: b?.status === "open",
      detail: b?.status === "open" ? `Presupuesto "${b.name}" abierto.` : `El presupuesto "${b?.name ?? r.budget_id}" está cerrado.`,
    });
    const known = fields.category != null && fields.category !== "indeterminada";
    const a = known ? await budgets.resolveAssignment(q, r.member_id, r.budget_id, fields.category) : null;
    assignmentId = a?.id ?? null;
    checks.push(
      !known
        ? { rule: "assignment_found", ok: null, detail: "Sin categoría todavía, no se sabe a qué asignación va." }
        : a
          ? {
              rule: "assignment_found",
              ok: true,
              detail: `Va a la asignación ${a.category_key ? `de ${a.category_key}` : "sin categoría"} (${formatArs(a.amount_cents)}).`,
            }
          : { rule: "assignment_found", ok: false, detail: "No tenés presupuesto asignado para esto." },
    );
  }
  const result = recommend({ ai, fields, checks, fieldsSource });
  await repo.updateRequest(q, r.id, {
    assignment_id: assignmentId,
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
  const r = await mustGet(ctx.db, requestId);
  assertStatus(r, ["submitted"], "analizar");
  const policy = await budgets.policyFor(ctx.db, r.budget_id);
  const clarifications = await repo.listClarifications(ctx.db, requestId);
  const image = await readReceipt(ctx, r);

  const res = await ctx.analyzer({
    image,
    mime: r.mime,
    fileSha256: r.file_sha256,
    description: r.description,
    clarifications,
    policy,
  });

  await tx(ctx.db, async (q) => {
    const now = await mustGet(q, requestId);
    if (now.status !== "submitted") throw new WorkflowError("La solicitud cambió mientras se analizaba.");
    if (!res.ok) {
      await repo.updateRequest(q, requestId, { ai_error: res.error, ai_model: res.model, ai_provider: res.provider });
      await repo.audit(q, requestId, "agente", "analysis_failed", { error: res.error, model: res.model });
      return;
    }
    await repo.updateRequest(q, requestId, {
      ai_output: JSON.stringify(res.output),
      ai_model: res.model,
      ai_provider: res.provider,
      ai_ran_at: new Date().toISOString(),
      ai_error: null,
      ai_fake: res.fake ? 1 : 0,
    });
    const result = await reevaluate(q, now, res.output, fieldsFromAi(res.output), "ai");
    if (result.recommendation === "needs_info") {
      for (const question of result.questions) await repo.addClarification(q, requestId, "agent", question);
      await repo.setStatus(q, requestId, "needs_info");
    } else {
      await repo.setStatus(q, requestId, "analyzed");
    }
    await repo.audit(q, requestId, "agente", "analyzed", {
      model: res.model,
      provider: res.provider,
      fake: res.fake,
      recommendation: result.recommendation,
      suspicious_instructions: res.output.suspicious_instructions,
    });
  });
  return mustGet(ctx.db, requestId);
}

/**
 * Vuelve a evaluar solicitudes analizadas y sin autorizar (por ejemplo, porque cambió una asignación).
 * No llama a la IA: recalcula checks y recomendación con los campos vigentes. Tiene que correr dentro de tx().
 */
export async function reevaluateOpen(q: Queryable, requestIds: number[], actor: string, why: string): Promise<number[]> {
  const done: number[] = [];
  for (const id of requestIds) {
    const r = await repo.getRequest(q, id);
    if (!r || r.status !== "analyzed" || (await repo.getActiveAuthorization(q, id))) continue;
    const source = r.fields_source === "organizer" ? "organizer" : "ai";
    const before = r.recommendation;
    const result = await reevaluate(q, r, aiOutputOf(r), currentFields(r), source);
    await repo.audit(q, id, actor, "reevaluated", { why, before, after: result.recommendation });
    done.push(id);
  }
  return done;
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

export async function respondClarification(ctx: Ctx, session: Session | null, requestId: number, message: string): Promise<void> {
  const s = assertRole(session, ["collaborator"]);
  const msg = message.trim();
  if (!msg) throw new WorkflowError("Escribí una respuesta.");
  if (msg.length > 1000) throw new WorkflowError("La respuesta es demasiado larga (máx. 1000 caracteres).");
  await tx(ctx.db, async (q) => {
    const r = await mustGet(q, requestId);
    if (!canSeeRequest(s, r)) throw new WorkflowError(`No existe la solicitud #${requestId}`);
    assertStatus(r, ["needs_info"], "responder");
    await repo.addClarification(q, requestId, "collaborator", msg);
    await repo.setStatus(q, requestId, "submitted");
    await repo.audit(q, requestId, actorName(s), "clarification_answered", { message: msg });
  });
}

export async function requestClarification(ctx: Ctx, session: Session | null, requestId: number, message: string): Promise<void> {
  const s = assertRole(session, ["organizer"]);
  const msg = message.trim();
  if (!msg) throw new WorkflowError("Escribí qué necesitás saber.");
  await tx(ctx.db, async (q) => {
    const r = await mustGet(q, requestId);
    assertStatus(r, ["analyzed", "needs_info"], "pedir aclaración sobre");
    await repo.addClarification(q, requestId, "organizer", msg.slice(0, 1000));
    await repo.setStatus(q, requestId, "needs_info");
    await repo.audit(q, requestId, actorName(s), "clarification_requested", { message: msg });
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

export async function correctFields(ctx: Ctx, session: Session | null, requestId: number, input: CorrectionInput): Promise<void> {
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
  await tx(ctx.db, async (q) => {
    const r = await mustGet(q, requestId);
    assertStatus(r, ["analyzed", "needs_info", "authorized"], "corregir");
    const auth = await repo.getActiveAuthorization(q, requestId);
    if (auth) {
      await repo.revokeAuthorization(q, auth.id, "El organizador corrigió los datos de la solicitud.");
      await repo.audit(q, requestId, actorName(s), "authorization_revoked", { authorization_id: auth.id, reason: "fields_corrected" });
    }
    const before = currentFields(r);
    const result = await reevaluate(q, r, aiOutputOf(r), fields, "organizer");
    await repo.setStatus(q, requestId, "analyzed");
    await repo.audit(q, requestId, actorName(s), "fields_corrected", { before, after: fields, recommendation: result.recommendation });
  });
}

// --- rechazar ---

export async function rejectRequest(ctx: Ctx, session: Session | null, requestId: number, reason: string): Promise<void> {
  const s = assertRole(session, ["organizer"]);
  await tx(ctx.db, async (q) => {
    const r = await mustGet(q, requestId);
    assertStatus(r, ["submitted", "analyzed", "needs_info", "authorized", "payment_failed"], "rechazar");
    const auth = await repo.getActiveAuthorization(q, requestId);
    if (auth) await repo.revokeAuthorization(q, auth.id, "Solicitud rechazada.");
    await repo.setStatus(q, requestId, "rejected");
    await repo.audit(q, requestId, actorName(s), "rejected", { reason: reason.trim().slice(0, 1000) || null });
  });
}

// --- autorizar ---

export type OwnerDecision = "full" | "up_to_balance" | "exception";

export interface AuthorizeInput {
  /** Checkbox "Verifiqué monto y destinatario". */
  verifiedAmountAndRecipient: boolean;
  /** Checkbox "Revisé las alertas" (obligatorio si la recomendación es flag_review o needs_info). */
  reviewedAlerts: boolean;
  reason: string;
  /** Qué paga el owner (§4.3 de la spec). Por defecto, el importe completo. */
  decision?: OwnerDecision;
}

/** Saldo de la asignación a la que va la solicitud (sin contar su propia autorización), o null si no hay. */
export async function assignmentBalanceFor(q: Queryable, r: RequestRow): Promise<AssignmentBalance | null> {
  if (r.assignment_id == null) return null;
  const a = await budgets.getAssignment(q, r.assignment_id);
  return a ? budgets.balanceOf(q, a, r.id) : null;
}

/** Qué opciones tiene el owner para esta solicitud y cuánto se pagaría con cada una. */
export interface DecisionOptions {
  amountCents: number;
  /** null = gasto sin presupuesto asignado (de antes de los presupuestos): solo "full". */
  balance: AssignmentBalance | null;
  full: boolean;
  upToBalance: number | null;
  exception: number | null;
}

export function decisionOptions(amountCents: number, balance: AssignmentBalance | null, legacy: boolean): DecisionOptions {
  if (legacy) return { amountCents, balance: null, full: true, upToBalance: null, exception: null };
  const available = balance?.availableCents ?? 0;
  return {
    amountCents,
    balance,
    full: amountCents <= available,
    upToBalance: available > 0 && available < amountCents ? available : null,
    exception: amountCents > available ? amountCents - available : null,
  };
}

/** Gastos de antes de los presupuestos: no tienen persona ni presupuesto y se autorizan como antes. */
function isLegacy(r: RequestRow): boolean {
  return r.member_id == null || r.budget_id == null;
}

export async function authorize(ctx: Ctx, session: Session | null, requestId: number, input: AuthorizeInput): Promise<number> {
  const s = assertRole(session, ["organizer"]);
  if (!input.verifiedAmountAndRecipient) throw new WorkflowError("Tildá \"Verifiqué monto y destinatario\".");
  const decision = input.decision ?? "full";
  return tx(ctx.db, async (q) => {
    const r = await mustGet(q, requestId);
    assertStatus(r, ["analyzed", "needs_info", "payment_failed"], "autorizar");
    if (await repo.getActiveAuthorization(q, requestId)) throw new WorkflowError("Ya hay una autorización activa.");
    if (!r.recommendation) throw new WorkflowError("La solicitud todavía no fue analizada.");
    if (r.recommendation === "reject") throw new WorkflowError("La recomendación es rechazar (fuera de política): no se puede autorizar.");
    const reason = input.reason.trim();
    if (r.recommendation === "flag_review" || r.recommendation === "needs_info") {
      if (!input.reviewedAlerts || !reason) {
        throw new WorkflowError("Hay alertas: tildá \"Revisé las alertas\" y escribí el motivo para autorizar igual.");
      }
    }
    if (r.amount_cents == null) throw new WorkflowError("Falta el importe.");
    const balance = await assignmentBalanceFor(q, r);
    const opts = decisionOptions(r.amount_cents, balance, isLegacy(r));
    let approved: number;
    let exceptionCents = 0;
    if (decision === "full") {
      if (!opts.full) {
        throw new WorkflowError(
          balance
            ? `El importe supera el saldo de la asignación (${formatArs(balance.availableCents)}): pagá hasta el saldo o como excepción.`
            : "No tiene presupuesto asignado para esto: solo se puede pagar como excepción.",
        );
      }
      approved = r.amount_cents;
    } else if (decision === "up_to_balance") {
      if (opts.upToBalance == null) throw new WorkflowError("\"Pagar hasta el saldo\" es para cuando queda saldo pero no alcanza.");
      approved = opts.upToBalance;
    } else {
      if (opts.exception == null) throw new WorkflowError("No hace falta una excepción: el importe entra en el saldo.");
      if (!reason) throw new WorkflowError("Para pagar como excepción, escribí el motivo.");
      approved = r.amount_cents;
      exceptionCents = opts.exception;
    }
    const policy = await budgets.policyFor(q, r.budget_id);
    const blocked = await hardLimitError(q, r, policy, approved);
    if (blocked) throw new WorkflowError(blocked);
    const { id, hash } = await insertAuthorization(q, r, policy, actorName(s), reason || null, {
      approvedCents: approved,
      assignmentId: r.assignment_id,
      mode: decision,
      exceptionCents,
      exceptionReason: decision === "exception" ? reason : null,
    });
    await repo.setStatus(q, r.id, "authorized");
    await repo.audit(q, r.id, actorName(s), "authorized", {
      authorization_id: id,
      binding_hash: hash,
      recommendation: r.recommendation,
      reviewed_alerts: input.reviewedAlerts,
      reason: reason || null,
      decision,
      requested_cents: r.amount_cents,
      approved_cents: approved,
      exception_cents: exceptionCents,
      available_cents: balance?.availableCents ?? null,
    });
    return id;
  });
}

/** Límites duros (no se pasan ni con motivo). Devuelve el motivo del bloqueo o null si se puede autorizar. */
async function hardLimitError(q: Queryable, r: RequestRow, policy: Policy, approvedCents: number): Promise<string | null> {
  if (r.amount_cents == null) return "Falta el importe.";
  if (r.amount_cents <= 0 || approvedCents <= 0) return "El importe tiene que ser mayor a cero.";
  if (r.amount_cents > policy.capPerReceiptCents) return "El importe supera el tope por comprobante.";
  if (approvedCents > (await getBudget(q)).availableCents) return "No alcanza el presupuesto disponible.";
  if (!normalizeRecipient(r.recipient)) return "La wallet de destino no es válida.";
  return null;
}

interface ApprovalDetail {
  approvedCents: number;
  assignmentId: number | null;
  mode: AuthorizationMode;
  exceptionCents: number;
  exceptionReason: string | null;
}

async function insertAuthorization(
  q: Queryable,
  r: RequestRow,
  policy: Policy,
  by: string,
  note: string | null,
  a: ApprovalDetail,
): Promise<{ id: number; hash: string }> {
  const b = bindingFor(r, policy.version, { approvedCents: a.approvedCents, assignmentId: a.assignmentId, mode: a.mode });
  const hash = bindingHash(b);
  const id = await repo.insertAuthorization(q, {
    request_id: r.id,
    amount_cents: b.amount_cents,
    requested_cents: b.requested_cents,
    assignment_id: a.assignmentId,
    exception_cents: a.exceptionCents,
    exception_reason: a.exceptionReason,
    mode: a.mode,
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

/** Un humano ya intervino en esta solicitud: el pago automático no aplica. */
async function humanIntervened(q: Queryable, r: RequestRow): Promise<boolean> {
  if (r.fields_source === "organizer") return true;
  if ((await repo.listClarifications(q, r.id)).some((c) => c.author === "organizer")) return true;
  return (await repo.listAuthorizations(q, r.id)).length > 0;
}

/** Tope de pagos automáticos en 24 h. null = automático (3 veces el máximo por ticket del presupuesto). */
export async function setAutoPayDailyCap(ctx: Ctx, session: Session | null, cents: number | null): Promise<void> {
  const s = assertRole(session, ["organizer"]);
  if (cents != null && (!Number.isSafeInteger(cents) || cents < 0)) throw new WorkflowError("El tope diario tiene que ser un monto válido, 0 o más.");
  await tx(ctx.db, async (q) => {
    const before = await repo.getCustomDailyCapCents(q);
    if (cents === before) return;
    await repo.setAutoPayDailyCapCents(q, cents);
    await repo.audit(q, null, actorName(s), "auto_pay_daily_cap_updated", { before_cents: before, after_cents: cents });
  });
}

/** Por qué un gasto no se paga solo (para el audit_log y la explicación). null = se paga solo. */
export type AutoPaySkip =
  | "not_approved"
  | "human_intervened"
  | "hard_limit"
  | "budget_closed_or_out_of_dates"
  | "no_assignment"
  | "over_balance"
  | "over_max_per_receipt"
  | "daily_cap"
  | "fake_ai_in_mainnet"
  | "unsafe_recipient";

export const AUTO_PAY_SKIP_TEXT: Record<AutoPaySkip, string> = {
  not_approved: "tiene alertas o falta información",
  human_intervened: "ya intervino un humano en la solicitud",
  hard_limit: "no cumple un límite duro de la política",
  budget_closed_or_out_of_dates: "el presupuesto está cerrado o el ticket es de otra fecha",
  no_assignment: "no tiene presupuesto asignado para esto",
  over_balance: "supera el saldo de la asignación",
  over_max_per_receipt: "supera el máximo por ticket del pago automático",
  daily_cap: "el agente llegó a su tope de 24 h",
  fake_ai_in_mainnet: "el análisis es de prueba y la app paga en mainnet",
  unsafe_recipient: "la wallet de destino no es segura",
};

/**
 * Autorización automática (§4.2 de la spec). La decide el código, nunca la IA. Se paga solo si y solo si:
 * 1. analyzed + approve (sin alertas); 2. ningún humano intervino; 3. límites duros; 4. presupuesto abierto
 * y ticket dentro de sus fechas; 5. importe ≤ disponible de la asignación; 6. importe ≤ máximo por ticket
 * del presupuesto; 7. entra en el tope de 24 h. Si falla una, queda en el audit_log cuál y va al owner.
 * Corre bajo el lock global de escritura: dos pagos automáticos de la misma asignación no leen el mismo saldo.
 */
export async function autoAuthorize(ctx: Ctx, requestId: number, nowMs = Date.now()): Promise<number | null> {
  return tx(ctx.db, async (q) => {
    const r = await mustGet(q, requestId);
    if (r.status !== "analyzed") return null;
    if (await repo.getActiveAuthorization(q, requestId)) return null;
    const skip = async (reason: AutoPaySkip, detail: Record<string, unknown> = {}) => {
      await repo.audit(q, r.id, "agente", "auto_pay_skipped", { reason, ...detail });
      return null;
    };
    // 1. Sin alertas.
    if (r.recommendation !== "approve" || r.amount_cents == null) return skip("not_approved");
    // 2. Si un humano ya intervino (pidió aclaración, corrigió datos o hubo una autorización antes), decide él.
    if (await humanIntervened(q, r)) return skip("human_intervened");
    // Barreras contra pagos accidentales: un análisis de prueba nunca mueve plata real; destinos seguros.
    if (ctx.paymentMode === "mainnet" && r.ai_fake) return skip("fake_ai_in_mainnet");
    const unsafe = unsafeRecipientReason(r.recipient);
    if (unsafe) return skip("unsafe_recipient", { detail: unsafe });
    // 3. Límites duros.
    const policy = await budgets.policyFor(q, r.budget_id);
    const hard = await hardLimitError(q, r, policy, r.amount_cents);
    if (hard) return skip("hard_limit", { detail: hard });
    // 4. Presupuesto abierto y ticket dentro de sus fechas.
    const budget = r.budget_id != null ? await budgets.getBudgetById(q, r.budget_id) : null;
    if (!budget || budget.status !== "open" || !r.receipt_date || r.receipt_date < budget.starts_on || r.receipt_date > budget.ends_on) {
      return skip("budget_closed_or_out_of_dates");
    }
    // 5. Saldo de la asignación.
    const balance = await assignmentBalanceFor(q, r);
    if (!balance) return skip("no_assignment");
    if (r.amount_cents > balance.availableCents) return skip("over_balance", { amount_cents: r.amount_cents, available_cents: balance.availableCents });
    // 6. Máximo por ticket del presupuesto (0 = sin pago automático).
    const max = budget.autopay_max_per_receipt_cents;
    if (max <= 0 || r.amount_cents > max) return skip("over_max_per_receipt", { amount_cents: r.amount_cents, max_cents: max });
    // 7. Tope de 24 h: limita cuánto puede pagar solo el agente aunque lleguen muchos gastos chicos.
    const cap = (await repo.dailyCapFor(q, max)).cents;
    const used = await repo.autoAuthorizedSinceCents(q, new Date(nowMs - 24 * 3600 * 1000).toISOString());
    if (used + r.amount_cents > cap) return skip("daily_cap", { used_cents: used, cap_cents: cap, amount_cents: r.amount_cents });

    const { id, hash } = await insertAuthorization(q, r, policy, `${repo.AUTO_PAY_ACTOR} ≤ ${formatArs(max)}`, null, {
      approvedCents: r.amount_cents,
      assignmentId: balance.assignment.id,
      mode: "auto",
      exceptionCents: 0,
      exceptionReason: null,
    });
    await repo.setStatus(q, r.id, "authorized");
    await repo.audit(q, r.id, "agente", "auto_authorized", {
      authorization_id: id,
      binding_hash: hash,
      amount_cents: r.amount_cents,
      max_cents: max,
      available_cents: balance.availableCents,
      assignment_id: balance.assignment.id,
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
      /** Si al enviarlo el agente lo pagaría solo (estimación: la decisión real se toma al enviar). */
      autoPay: string | null;
      budgetName: string;
      /** Lo que le queda en la asignación a la que iría (null si no hay asignación). */
      availableCents: number | null;
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
export async function previewExpense(
  ctx: Ctx,
  session: Session | null,
  file: { bytes: Uint8Array },
  budgetId: number | null = null,
): Promise<PreviewResult> {
  const s = assertRole(session, ["collaborator"]);
  const { bytes } = file;
  if (!bytes.length) throw new WorkflowError("Falta la imagen del comprobante.");
  if (bytes.length > MAX_RECEIPT_BYTES) throw new WorkflowError("La imagen supera los 4 MB.");
  const mime = sniffMime(bytes);
  if (!mime || !(ALLOWED_MIME as readonly string[]).includes(mime)) throw new WorkflowError("La imagen tiene que ser JPEG, PNG o WebP.");

  const budget = await pickBudget(ctx.db, s.memberId, budgetId);
  const policy = await budgets.policyFor(ctx.db, budget.id);
  const sha = sha256Hex(bytes);
  const res = await ctx.analyzer({ image: Buffer.from(bytes), mime, fileSha256: sha, description: "", clarifications: [], policy });
  if (!res.ok) return { ok: false, error: res.error };

  const ai = res.output;
  const fields = fieldsFromAi(ai);
  const duplicates = await findDuplicates(ctx.db, -1, sha, fields);
  const all = evaluateChecks({
    policy,
    fields,
    recipient: "",
    availableForRequestCents: (await getBudget(ctx.db)).availableCents,
    duplicates,
  });
  const checks = all.filter((c) => PREVIEW_RULES.includes(c.rule));
  const failed = (rule: Check["rule"]) => checks.find((c) => c.rule === rule)?.ok === false;
  const unknown = (rule: Check["rule"]) => checks.find((c) => c.rule === rule)?.ok == null;
  // Al colaborador solo se le muestran los números de sus propias solicitudes; las de otros, sin número.
  const allDup = [...new Set([...duplicates.file, ...duplicates.data])];
  const mine = new Set((await repo.listRequestsByMember(ctx.db, s.memberId)).map((r) => r.id));
  const duplicateOf = allDup.filter((id) => mine.has(id));
  const suspicious = ai.suspicious_instructions;
  const cat = fields.category;

  let verdict: PreviewVerdict;
  let headline: string;
  if (allDup.length) {
    verdict = "review";
    headline = duplicateOf.length
      ? `Parece el mismo ticket que ya presentaste (#${duplicateOf.join(", #")}).`
      : "Parece un ticket que ya se presentó. El organizador lo va a revisar.";
  } else if (suspicious.length) {
    verdict = "review";
    headline = "El ticket trae texto que parece una instrucción. Lo ignoré, pero el organizador lo va a revisar.";
  } else if (failed("category_allowed")) {
    verdict = "outside";
    headline = `Esto no parece ${policy.categories.join(" ni ")}: probablemente no se reembolse.`;
  } else if (failed("date_in_range")) {
    verdict = "outside";
    headline = `La fecha del ticket está fuera de "${budget.name}" (${policy.startDate} a ${policy.endDate}).`;
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

  // Estimación de si se pagaría solo (la decisión real se toma al enviar, con las 7 condiciones).
  let autoPay: string | null = null;
  let balance: AssignmentBalance | null = null;
  if (verdict === "fits" && fields.amountCents != null) {
    const a = await budgets.resolveAssignment(ctx.db, s.memberId, budget.id, cat);
    balance = a ? await budgets.balanceOf(ctx.db, a) : null;
    const max = budget.autopay_max_per_receipt_cents;
    const used = await repo.autoAuthorizedSinceCents(ctx.db, new Date(Date.now() - 24 * 3600 * 1000).toISOString());
    const cap = (await repo.dailyCapFor(ctx.db, max)).cents;
    if (!balance) autoPay = "No tenés presupuesto asignado para esto: lo decide el organizador.";
    else if (fields.amountCents > balance.availableCents) autoPay = `Supera lo que te queda (${formatArs(balance.availableCents)}): lo decide el organizador.`;
    else if (max <= 0) autoPay = "Este presupuesto no tiene pago automático: lo aprueba el organizador.";
    else if (fields.amountCents > max) autoPay = `Supera el máximo por ticket del pago automático (${formatArs(max)}): lo aprueba el organizador.`;
    else if (used + fields.amountCents > cap) autoPay = "Hoy el agente ya llegó a su tope de pagos automáticos: lo aprueba el organizador.";
    else autoPay = `Entra en lo que te queda (${formatArs(balance.availableCents)}): si al enviarlo sigue sin alertas, el agente te lo paga solo.`;
  }

  return {
    ok: true,
    autoPay,
    budgetName: budget.name,
    availableCents: balance?.availableCents ?? null,
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
