// Consultas a Postgres. Sin lógica de negocio: eso vive en workflow.ts, policy.ts, payTool.ts, etc.
// Cada función recibe un Queryable: la base o la transacción abierta (dentro de tx(), siempre la transacción).
import type { Queryable, Row } from "./db.ts";
import { nowIso } from "./db.ts";
import { DEFAULT_AUTO_PAY_LIMIT_CENTS } from "./demo.ts";
import type {
  AuditRow,
  AuthorizationRow,
  ClarificationRow,
  EventRow,
  PaymentRow,
  Policy,
  RequestRow,
  RequestStatus,
} from "./types.ts";

async function one<T>(q: Queryable, sql: string, params: unknown[] = []): Promise<T | null> {
  return ((await q.query<T>(sql, params))[0] as T | undefined) ?? null;
}

async function insertId(q: Queryable, sql: string, params: unknown[]): Promise<number> {
  const row = await one<{ id: number }>(q, `${sql} RETURNING id`, params);
  return row!.id;
}

// --- event ---

export function getEvent(q: Queryable): Promise<EventRow | null> {
  return one<EventRow>(q, "SELECT * FROM event WHERE id = 1");
}

export function eventToPolicy(e: EventRow): Policy {
  return {
    name: e.name,
    startDate: e.start_date,
    endDate: e.end_date,
    categories: JSON.parse(e.categories) as string[],
    capPerReceiptCents: e.cap_per_receipt_cents,
    budgetCents: e.budget_cents,
    version: e.policy_version,
  };
}

export async function getPolicy(q: Queryable): Promise<Policy> {
  const e = await getEvent(q);
  if (!e) throw new Error("No hay evento configurado. Corré `npm run demo:reset`.");
  return eventToPolicy(e);
}

export async function upsertEvent(q: Queryable, p: Omit<Policy, "version">): Promise<void> {
  const now = nowIso();
  await q.query(
    `INSERT INTO event (id, name, start_date, end_date, categories, cap_per_receipt_cents, budget_cents, policy_version, created_at, updated_at)
     VALUES (1, $1, $2, $3, $4, $5, $6, 1, $7, $7)
     ON CONFLICT (id) DO UPDATE SET name = excluded.name, start_date = excluded.start_date, end_date = excluded.end_date,
       categories = excluded.categories, cap_per_receipt_cents = excluded.cap_per_receipt_cents, budget_cents = excluded.budget_cents,
       policy_version = event.policy_version + 1, updated_at = excluded.updated_at`,
    [p.name, p.startDate, p.endDate, JSON.stringify(p.categories), p.capPerReceiptCents, p.budgetCents, now],
  );
}

// --- requests ---

export async function countRequests(q: Queryable): Promise<number> {
  return (await one<{ n: number }>(q, "SELECT COUNT(*)::int AS n FROM requests"))!.n;
}

export function getRequest(q: Queryable, id: number): Promise<RequestRow | null> {
  return one<RequestRow>(q, "SELECT * FROM requests WHERE id = $1", [id]);
}

export function listRequests(q: Queryable): Promise<RequestRow[]> {
  return q.query<RequestRow>("SELECT * FROM requests ORDER BY id DESC");
}

export function insertRequest(
  q: Queryable,
  r: { description: string; recipient: string; claimantName: string | null; filePath: string; fileSha256: string; mime: string },
): Promise<number> {
  const now = nowIso();
  return insertId(
    q,
    `INSERT INTO requests (created_at, updated_at, description, recipient, claimant_name, file_path, file_sha256, mime, status)
     VALUES ($1, $1, $2, $3, $4, $5, $6, $7, 'submitted')`,
    [now, r.description, r.recipient, r.claimantName, r.filePath, r.fileSha256, r.mime],
  );
}

const UPDATABLE = new Set([
  "status",
  "ai_output",
  "ai_model",
  "ai_provider",
  "ai_ran_at",
  "ai_error",
  "ai_fake",
  "receipt_date",
  "merchant",
  "concept",
  "amount_cents",
  "currency",
  "category",
  "fields_source",
  "checks",
  "duplicate_flags",
  "recommendation",
  "explanation",
  "policy_version",
]);

/** UPDATE con columnas de una lista blanca (los nombres van al SQL, los valores como parámetros). */
async function updateWhitelisted(q: Queryable, table: string, allowed: Set<string>, id: number, fields: Row): Promise<void> {
  const keys = Object.keys(fields);
  for (const k of keys) if (!allowed.has(k)) throw new Error(`Campo no actualizable en ${table}: ${k}`);
  if (!keys.length) return;
  const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
  const values = keys.map((k) => fields[k] ?? null);
  await q.query(`UPDATE ${table} SET ${sets}, updated_at = $${keys.length + 1} WHERE id = $${keys.length + 2}`, [...values, nowIso(), id]);
}

export function updateRequest(q: Queryable, id: number, fields: Partial<RequestRow>): Promise<void> {
  return updateWhitelisted(q, "requests", UPDATABLE, id, fields as Row);
}

export function setStatus(q: Queryable, id: number, status: RequestStatus): Promise<void> {
  return updateRequest(q, id, { status });
}

/** Otras solicitudes con el mismo archivo (cualquier estado). */
export function findByFileSha(q: Queryable, sha: string, excludeId: number): Promise<RequestRow[]> {
  return q.query<RequestRow>("SELECT * FROM requests WHERE file_sha256 = $1 AND id <> $2 ORDER BY id", [sha, excludeId]);
}

/** Otras solicitudes no rechazadas con fecha e importe iguales (el comercio se compara normalizado en duplicates.ts). */
export function findByDateAmount(q: Queryable, date: string, amountCents: number, excludeId: number): Promise<RequestRow[]> {
  return q.query<RequestRow>(
    "SELECT * FROM requests WHERE receipt_date = $1 AND amount_cents = $2 AND id <> $3 AND status <> 'rejected' ORDER BY id",
    [date, amountCents, excludeId],
  );
}

// --- clarifications ---

export function listClarifications(q: Queryable, requestId: number): Promise<ClarificationRow[]> {
  return q.query<ClarificationRow>("SELECT * FROM clarifications WHERE request_id = $1 ORDER BY id", [requestId]);
}

export async function addClarification(q: Queryable, requestId: number, author: ClarificationRow["author"], message: string): Promise<void> {
  await q.query("INSERT INTO clarifications (request_id, author, message, created_at) VALUES ($1, $2, $3, $4)", [
    requestId,
    author,
    message,
    nowIso(),
  ]);
}

// --- authorizations ---

export function getActiveAuthorization(q: Queryable, requestId: number): Promise<AuthorizationRow | null> {
  return one<AuthorizationRow>(q, "SELECT * FROM authorizations WHERE request_id = $1 AND revoked_at IS NULL", [requestId]);
}

export function getAuthorization(q: Queryable, id: number): Promise<AuthorizationRow | null> {
  return one<AuthorizationRow>(q, "SELECT * FROM authorizations WHERE id = $1", [id]);
}

export function listAuthorizations(q: Queryable, requestId: number): Promise<AuthorizationRow[]> {
  return q.query<AuthorizationRow>("SELECT * FROM authorizations WHERE request_id = $1 ORDER BY id", [requestId]);
}

export function insertAuthorization(
  q: Queryable,
  a: Omit<AuthorizationRow, "id" | "created_at" | "revoked_at" | "revoke_reason">,
): Promise<number> {
  return insertId(
    q,
    `INSERT INTO authorizations (request_id, amount_cents, token_amount, token_address, chain_id, recipient, binding_hash, policy_version, authorized_by, review_note, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      a.request_id,
      a.amount_cents,
      a.token_amount,
      a.token_address,
      a.chain_id,
      a.recipient,
      a.binding_hash,
      a.policy_version,
      a.authorized_by,
      a.review_note,
      nowIso(),
    ],
  );
}

export async function revokeAuthorization(q: Queryable, id: number, reason: string): Promise<void> {
  await q.query("UPDATE authorizations SET revoked_at = $1, revoke_reason = $2 WHERE id = $3 AND revoked_at IS NULL", [
    nowIso(),
    reason,
    id,
  ]);
}

// --- payments ---

export const LIVE_PAYMENT_STATUSES = ["preparing", "signed", "sent", "uncertain"] as const;

export function getPayment(q: Queryable, id: number): Promise<PaymentRow | null> {
  return one<PaymentRow>(q, "SELECT * FROM payments WHERE id = $1", [id]);
}

export function listPayments(q: Queryable, requestId: number): Promise<PaymentRow[]> {
  return q.query<PaymentRow>("SELECT * FROM payments WHERE request_id = $1 ORDER BY id", [requestId]);
}

export function latestPayment(q: Queryable, requestId: number): Promise<PaymentRow | null> {
  return one<PaymentRow>(q, "SELECT * FROM payments WHERE request_id = $1 ORDER BY id DESC LIMIT 1", [requestId]);
}

export function listLivePayments(q: Queryable): Promise<PaymentRow[]> {
  return q.query<PaymentRow>("SELECT * FROM payments WHERE status IN ('preparing','signed','sent','uncertain') ORDER BY id");
}

export function insertPayment(
  q: Queryable,
  p: { requestId: number; authorizationId: number; mode: PaymentRow["mode"]; fromAddress: string | null },
): Promise<number> {
  const now = nowIso();
  return insertId(
    q,
    `INSERT INTO payments (request_id, authorization_id, mode, status, from_address, created_at, updated_at)
     VALUES ($1, $2, $3, 'preparing', $4, $5, $5)`,
    [p.requestId, p.authorizationId, p.mode, p.fromAddress, now],
  );
}

const PAYMENT_UPDATABLE = new Set(["status", "nonce", "raw_tx", "tx_hash", "block_number", "attribution_ok", "error", "from_address"]);

export function updatePayment(q: Queryable, id: number, fields: Partial<PaymentRow>): Promise<void> {
  return updateWhitelisted(q, "payments", PAYMENT_UPDATABLE, id, fields as Row);
}

// --- audit ---

export async function audit(q: Queryable, requestId: number | null, actor: string, action: string, detail?: unknown): Promise<void> {
  await q.query("INSERT INTO audit_log (request_id, actor, action, detail, created_at) VALUES ($1, $2, $3, $4, $5)", [
    requestId,
    actor,
    action,
    detail === undefined ? null : JSON.stringify(detail),
    nowIso(),
  ]);
}

export function listAudit(q: Queryable, requestId: number): Promise<AuditRow[]> {
  return q.query<AuditRow>("SELECT * FROM audit_log WHERE request_id = $1 ORDER BY id", [requestId]);
}

// --- perfil del colaborador ---

export interface CollaboratorProfile {
  name: string | null;
  wallet: string;
}

export async function getCollaboratorProfile(q: Queryable): Promise<CollaboratorProfile | null> {
  const row = await one<CollaboratorProfile>(q, "SELECT name, wallet FROM collaborator_profile WHERE id = 1");
  return row ? { name: row.name ?? null, wallet: row.wallet } : null;
}

export async function getCollaboratorWallet(q: Queryable): Promise<string | null> {
  return (await getCollaboratorProfile(q))?.wallet ?? null;
}

export async function setCollaboratorProfile(q: Queryable, p: { name: string | null; wallet: string }): Promise<void> {
  await q.query(
    `INSERT INTO collaborator_profile (id, name, wallet, updated_at) VALUES (1, $1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET name = excluded.name, wallet = excluded.wallet, updated_at = excluded.updated_at`,
    [p.name, p.wallet, nowIso()],
  );
}

// --- configuración del agente ---

/** Prefijo de authorized_by en las autorizaciones que hace el agente solo. */
export const AUTO_PAY_ACTOR = "agente · pago automático";

/** Pagos confirmados que autorizó el agente solo. */
export async function autoPaidTotals(q: Queryable): Promise<{ count: number; cents: number }> {
  const row = (await one<{ n: number; c: number }>(
    q,
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(a.amount_cents), 0)::bigint AS c
     FROM authorizations a JOIN payments p ON p.authorization_id = a.id
     WHERE p.status = 'confirmed' AND a.authorized_by LIKE $1`,
    [`${AUTO_PAY_ACTOR}%`],
  ))!;
  return { count: row.n, cents: row.c };
}

/** Límite de pago automático en centavos (0 = apagado). Sin configurar, vale el de la demo. */
export async function getAutoPayLimitCents(q: Queryable): Promise<number> {
  const row = await one<{ v: number }>(q, "SELECT auto_pay_limit_cents AS v FROM agent_settings WHERE id = 1");
  return row ? row.v : DEFAULT_AUTO_PAY_LIMIT_CENTS;
}

export async function setAutoPayLimitCents(q: Queryable, cents: number): Promise<void> {
  await q.query(
    `INSERT INTO agent_settings (id, auto_pay_limit_cents, updated_at) VALUES (1, $1, $2)
     ON CONFLICT (id) DO UPDATE SET auto_pay_limit_cents = excluded.auto_pay_limit_cents, updated_at = excluded.updated_at`,
    [cents, nowIso()],
  );
}

/** Sin tope diario configurado, el agente puede autorizar solo hasta este múltiplo del límite por gasto en 24 h. */
export const DEFAULT_DAILY_CAP_MULTIPLIER = 3;

/** Tope de pagos automáticos en 24 h, en centavos. `custom` = lo fijó el organizador. */
export async function getAutoPayDailyCap(q: Queryable): Promise<{ cents: number; custom: boolean }> {
  const row = await one<{ v: number | null }>(q, "SELECT auto_pay_daily_cap_cents AS v FROM agent_settings WHERE id = 1");
  if (row?.v != null) return { cents: row.v, custom: true };
  return { cents: (await getAutoPayLimitCents(q)) * DEFAULT_DAILY_CAP_MULTIPLIER, custom: false };
}

/** null vuelve al tope automático. */
export async function setAutoPayDailyCapCents(q: Queryable, cents: number | null): Promise<void> {
  await q.query(
    `INSERT INTO agent_settings (id, auto_pay_limit_cents, auto_pay_daily_cap_cents, updated_at) VALUES (1, $1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET auto_pay_daily_cap_cents = excluded.auto_pay_daily_cap_cents, updated_at = excluded.updated_at`,
    [await getAutoPayLimitCents(q), cents, nowIso()],
  );
}

/** Lo que el agente autorizó solo desde `sinceIso` y sigue vigente (pagado, pagándose o incierto). Las revocadas no cuentan. */
export async function autoAuthorizedSinceCents(q: Queryable, sinceIso: string): Promise<number> {
  return (await autoAuthorizedSince(q, sinceIso)).cents;
}

/** Ids de solicitudes con una autorización vigente del agente (pagadas o pagándose solas). */
export async function autoAuthorizedRequestIds(q: Queryable): Promise<Set<number>> {
  const rows = await q.query<{ id: number }>(
    "SELECT DISTINCT request_id AS id FROM authorizations WHERE authorized_by LIKE $1 AND revoked_at IS NULL",
    [`${AUTO_PAY_ACTOR}%`],
  );
  return new Set(rows.map((r) => r.id));
}

/** Cuántos gastos autorizó solo el agente desde `sinceIso` (vigentes) y por cuánto. */
export async function autoAuthorizedSince(q: Queryable, sinceIso: string): Promise<{ count: number; cents: number }> {
  const row = (await one<{ n: number; c: number }>(
    q,
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(amount_cents), 0)::bigint AS c FROM authorizations
     WHERE authorized_by LIKE $1 AND revoked_at IS NULL AND created_at >= $2`,
    [`${AUTO_PAY_ACTOR}%`, sinceIso],
  ))!;
  return { count: row.n, cents: row.c };
}
