// Consultas a SQLite. Sin lógica de negocio: eso vive en workflow.ts, policy.ts, payTool.ts, etc.
import type { DB } from "./db.ts";
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

type Row = Record<string, unknown>;

// --- event ---

export function getEvent(db: DB): EventRow | null {
  return (db.prepare("SELECT * FROM event WHERE id = 1").get() as EventRow | undefined) ?? null;
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

export function getPolicy(db: DB): Policy {
  const e = getEvent(db);
  if (!e) throw new Error("No hay evento configurado. Corré `npm run demo:reset`.");
  return eventToPolicy(e);
}

export function upsertEvent(db: DB, p: Omit<Policy, "version">): void {
  const now = nowIso();
  const existing = getEvent(db);
  if (!existing) {
    db.prepare(
      `INSERT INTO event (id, name, start_date, end_date, categories, cap_per_receipt_cents, budget_cents, policy_version, created_at, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    ).run(p.name, p.startDate, p.endDate, JSON.stringify(p.categories), p.capPerReceiptCents, p.budgetCents, now, now);
  } else {
    db.prepare(
      `UPDATE event SET name = ?, start_date = ?, end_date = ?, categories = ?, cap_per_receipt_cents = ?, budget_cents = ?,
         policy_version = policy_version + 1, updated_at = ? WHERE id = 1`,
    ).run(p.name, p.startDate, p.endDate, JSON.stringify(p.categories), p.capPerReceiptCents, p.budgetCents, now);
  }
}

// --- requests ---

export function countRequests(db: DB): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM requests").get() as { n: number }).n;
}

export function getRequest(db: DB, id: number): RequestRow | null {
  return (db.prepare("SELECT * FROM requests WHERE id = ?").get(id) as RequestRow | undefined) ?? null;
}

export function listRequests(db: DB): RequestRow[] {
  return db.prepare("SELECT * FROM requests ORDER BY id DESC").all() as unknown as RequestRow[];
}

export function insertRequest(
  db: DB,
  r: { description: string; recipient: string; claimantName: string | null; filePath: string; fileSha256: string; mime: string },
): number {
  const now = nowIso();
  const res = db
    .prepare(
      `INSERT INTO requests (created_at, updated_at, description, recipient, claimant_name, file_path, file_sha256, mime, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'submitted')`,
    )
    .run(now, now, r.description, r.recipient, r.claimantName, r.filePath, r.fileSha256, r.mime);
  return Number(res.lastInsertRowid);
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

export function updateRequest(db: DB, id: number, fields: Partial<RequestRow>): void {
  const keys = Object.keys(fields);
  for (const k of keys) if (!UPDATABLE.has(k)) throw new Error(`Campo no actualizable: ${k}`);
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => (fields as Row)[k] as string | number | null);
  db.prepare(`UPDATE requests SET ${sets}, updated_at = ? WHERE id = ?`).run(...values, nowIso(), id);
}

export function setStatus(db: DB, id: number, status: RequestStatus): void {
  updateRequest(db, id, { status });
}

/** Otras solicitudes con el mismo archivo (cualquier estado). */
export function findByFileSha(db: DB, sha: string, excludeId: number): RequestRow[] {
  return db
    .prepare("SELECT * FROM requests WHERE file_sha256 = ? AND id <> ? ORDER BY id")
    .all(sha, excludeId) as unknown as RequestRow[];
}

/** Otras solicitudes no rechazadas con fecha e importe iguales (el comercio se compara normalizado en duplicates.ts). */
export function findByDateAmount(db: DB, date: string, amountCents: number, excludeId: number): RequestRow[] {
  return db
    .prepare(
      `SELECT * FROM requests WHERE receipt_date = ? AND amount_cents = ? AND id <> ? AND status <> 'rejected' ORDER BY id`,
    )
    .all(date, amountCents, excludeId) as unknown as RequestRow[];
}

// --- clarifications ---

export function listClarifications(db: DB, requestId: number): ClarificationRow[] {
  return db
    .prepare("SELECT * FROM clarifications WHERE request_id = ? ORDER BY id")
    .all(requestId) as unknown as ClarificationRow[];
}

export function addClarification(db: DB, requestId: number, author: ClarificationRow["author"], message: string): void {
  db.prepare("INSERT INTO clarifications (request_id, author, message, created_at) VALUES (?, ?, ?, ?)").run(
    requestId,
    author,
    message,
    nowIso(),
  );
}

// --- authorizations ---

export function getActiveAuthorization(db: DB, requestId: number): AuthorizationRow | null {
  return (
    (db
      .prepare("SELECT * FROM authorizations WHERE request_id = ? AND revoked_at IS NULL")
      .get(requestId) as AuthorizationRow | undefined) ?? null
  );
}

export function getAuthorization(db: DB, id: number): AuthorizationRow | null {
  return (db.prepare("SELECT * FROM authorizations WHERE id = ?").get(id) as AuthorizationRow | undefined) ?? null;
}

export function listAuthorizations(db: DB, requestId: number): AuthorizationRow[] {
  return db
    .prepare("SELECT * FROM authorizations WHERE request_id = ? ORDER BY id")
    .all(requestId) as unknown as AuthorizationRow[];
}

export function insertAuthorization(db: DB, a: Omit<AuthorizationRow, "id" | "created_at" | "revoked_at" | "revoke_reason">): number {
  const res = db
    .prepare(
      `INSERT INTO authorizations (request_id, amount_cents, token_amount, token_address, chain_id, recipient, binding_hash, policy_version, authorized_by, review_note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
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
    );
  return Number(res.lastInsertRowid);
}

export function revokeAuthorization(db: DB, id: number, reason: string): void {
  db.prepare("UPDATE authorizations SET revoked_at = ?, revoke_reason = ? WHERE id = ? AND revoked_at IS NULL").run(
    nowIso(),
    reason,
    id,
  );
}

// --- payments ---

export const LIVE_PAYMENT_STATUSES = ["preparing", "signed", "sent", "uncertain"] as const;

export function getPayment(db: DB, id: number): PaymentRow | null {
  return (db.prepare("SELECT * FROM payments WHERE id = ?").get(id) as PaymentRow | undefined) ?? null;
}

export function listPayments(db: DB, requestId: number): PaymentRow[] {
  return db.prepare("SELECT * FROM payments WHERE request_id = ? ORDER BY id").all(requestId) as unknown as PaymentRow[];
}

export function latestPayment(db: DB, requestId: number): PaymentRow | null {
  return (
    (db.prepare("SELECT * FROM payments WHERE request_id = ? ORDER BY id DESC LIMIT 1").get(requestId) as
      | PaymentRow
      | undefined) ?? null
  );
}

export function listLivePayments(db: DB): PaymentRow[] {
  return db
    .prepare("SELECT * FROM payments WHERE status IN ('preparing','signed','sent','uncertain') ORDER BY id")
    .all() as unknown as PaymentRow[];
}

export function insertPayment(
  db: DB,
  p: { requestId: number; authorizationId: number; mode: PaymentRow["mode"]; fromAddress: string | null },
): number {
  const now = nowIso();
  const res = db
    .prepare(
      `INSERT INTO payments (request_id, authorization_id, mode, status, from_address, created_at, updated_at)
       VALUES (?, ?, ?, 'preparing', ?, ?, ?)`,
    )
    .run(p.requestId, p.authorizationId, p.mode, p.fromAddress, now, now);
  return Number(res.lastInsertRowid);
}

const PAYMENT_UPDATABLE = new Set(["status", "nonce", "raw_tx", "tx_hash", "block_number", "attribution_ok", "error", "from_address"]);

export function updatePayment(db: DB, id: number, fields: Partial<PaymentRow>): void {
  const keys = Object.keys(fields);
  for (const k of keys) if (!PAYMENT_UPDATABLE.has(k)) throw new Error(`Campo de pago no actualizable: ${k}`);
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => (fields as Row)[k] as string | number | null);
  db.prepare(`UPDATE payments SET ${sets}, updated_at = ? WHERE id = ?`).run(...values, nowIso(), id);
}

// --- audit ---

export function audit(db: DB, requestId: number | null, actor: string, action: string, detail?: unknown): void {
  db.prepare("INSERT INTO audit_log (request_id, actor, action, detail, created_at) VALUES (?, ?, ?, ?, ?)").run(
    requestId,
    actor,
    action,
    detail === undefined ? null : JSON.stringify(detail),
    nowIso(),
  );
}

export function listAudit(db: DB, requestId: number): AuditRow[] {
  return db.prepare("SELECT * FROM audit_log WHERE request_id = ? ORDER BY id").all(requestId) as unknown as AuditRow[];
}

// --- perfil del colaborador ---

export interface CollaboratorProfile {
  name: string | null;
  wallet: string;
}

export function getCollaboratorProfile(db: DB): CollaboratorProfile | null {
  const row = db.prepare("SELECT name, wallet FROM collaborator_profile WHERE id = 1").get() as CollaboratorProfile | undefined;
  return row ? { name: row.name ?? null, wallet: row.wallet } : null;
}

export function getCollaboratorWallet(db: DB): string | null {
  return getCollaboratorProfile(db)?.wallet ?? null;
}

export function setCollaboratorProfile(db: DB, p: { name: string | null; wallet: string }): void {
  db.prepare(
    "INSERT INTO collaborator_profile (id, name, wallet, updated_at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, wallet = excluded.wallet, updated_at = excluded.updated_at",
  ).run(p.name, p.wallet, nowIso());
}

// --- configuración del agente ---

/** Prefijo de authorized_by en las autorizaciones que hace el agente solo. */
export const AUTO_PAY_ACTOR = "agente · pago automático";

/** Pagos confirmados que autorizó el agente solo. */
export function autoPaidTotals(db: DB): { count: number; cents: number } {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS n, COALESCE(SUM(a.amount_cents), 0) AS c FROM authorizations a JOIN payments p ON p.authorization_id = a.id WHERE p.status = 'confirmed' AND a.authorized_by LIKE ?",
    )
    .get(`${AUTO_PAY_ACTOR}%`) as { n: number; c: number };
  return { count: row.n, cents: row.c };
}

/** Límite de pago automático en centavos (0 = apagado). Sin configurar, vale el de la demo. */
export function getAutoPayLimitCents(db: DB): number {
  const row = db.prepare("SELECT auto_pay_limit_cents AS v FROM agent_settings WHERE id = 1").get() as { v: number } | undefined;
  return row ? row.v : DEFAULT_AUTO_PAY_LIMIT_CENTS;
}

export function setAutoPayLimitCents(db: DB, cents: number): void {
  db.prepare(
    "INSERT INTO agent_settings (id, auto_pay_limit_cents, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET auto_pay_limit_cents = excluded.auto_pay_limit_cents, updated_at = excluded.updated_at",
  ).run(cents, nowIso());
}

/** Sin tope diario configurado, el agente puede autorizar solo hasta este múltiplo del límite por gasto en 24 h. */
export const DEFAULT_DAILY_CAP_MULTIPLIER = 3;

/** Tope de pagos automáticos en 24 h, en centavos. `custom` = lo fijó el organizador. */
export function getAutoPayDailyCap(db: DB): { cents: number; custom: boolean } {
  const row = db.prepare("SELECT auto_pay_daily_cap_cents AS v FROM agent_settings WHERE id = 1").get() as { v: number | null } | undefined;
  if (row?.v != null) return { cents: row.v, custom: true };
  return { cents: getAutoPayLimitCents(db) * DEFAULT_DAILY_CAP_MULTIPLIER, custom: false };
}

/** null vuelve al tope automático. */
export function setAutoPayDailyCapCents(db: DB, cents: number | null): void {
  db.prepare(
    "INSERT INTO agent_settings (id, auto_pay_limit_cents, auto_pay_daily_cap_cents, updated_at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET auto_pay_daily_cap_cents = excluded.auto_pay_daily_cap_cents, updated_at = excluded.updated_at",
  ).run(getAutoPayLimitCents(db), cents, nowIso());
}

/** Lo que el agente autorizó solo desde `sinceIso` y sigue vigente (pagado, pagándose o incierto). Las revocadas no cuentan. */
export function autoAuthorizedSinceCents(db: DB, sinceIso: string): number {
  const row = db
    .prepare("SELECT COALESCE(SUM(amount_cents), 0) AS c FROM authorizations WHERE authorized_by LIKE ? AND revoked_at IS NULL AND created_at >= ?")
    .get(`${AUTO_PAY_ACTOR}%`, sinceIso) as { c: number };
  return row.c;
}

/** Ids de solicitudes con una autorización vigente del agente (pagadas o pagándose solas). */
export function autoAuthorizedRequestIds(db: DB): Set<number> {
  const rows = db
    .prepare("SELECT DISTINCT request_id AS id FROM authorizations WHERE authorized_by LIKE ? AND revoked_at IS NULL")
    .all(`${AUTO_PAY_ACTOR}%`) as { id: number }[];
  return new Set(rows.map((r) => r.id));
}

/** Cuántos gastos autorizó solo el agente desde `sinceIso` (vigentes) y por cuánto. */
export function autoAuthorizedSince(db: DB, sinceIso: string): { count: number; cents: number } {
  const row = db
    .prepare("SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS c FROM authorizations WHERE authorized_by LIKE ? AND revoked_at IS NULL AND created_at >= ?")
    .get(`${AUTO_PAY_ACTOR}%`, sinceIso) as { n: number; c: number };
  return { count: row.n, cents: row.c };
}
