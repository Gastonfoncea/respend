// SQLite con node:sqlite (DatabaseSync). Migraciones idempotentes y helper de transacción.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export type DB = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS event (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  categories TEXT NOT NULL,
  cap_per_receipt_cents INTEGER NOT NULL,
  budget_cents INTEGER NOT NULL,
  policy_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  description TEXT NOT NULL,
  recipient TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_sha256 TEXT NOT NULL,
  mime TEXT NOT NULL,
  status TEXT NOT NULL,
  ai_output TEXT,
  ai_model TEXT,
  ai_provider TEXT,
  ai_ran_at TEXT,
  ai_error TEXT,
  ai_fake INTEGER NOT NULL DEFAULT 0,
  claimant_name TEXT,
  receipt_date TEXT,
  merchant TEXT,
  concept TEXT,
  amount_cents INTEGER,
  currency TEXT,
  category TEXT,
  fields_source TEXT,
  checks TEXT,
  duplicate_flags TEXT,
  recommendation TEXT,
  explanation TEXT,
  policy_version INTEGER
);

CREATE TABLE IF NOT EXISTS clarifications (
  id INTEGER PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES requests(id),
  author TEXT NOT NULL CHECK (author IN ('agent','collaborator','organizer')),
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS authorizations (
  id INTEGER PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES requests(id),
  amount_cents INTEGER NOT NULL,
  token_amount TEXT NOT NULL,
  token_address TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  recipient TEXT NOT NULL,
  binding_hash TEXT NOT NULL,
  policy_version INTEGER NOT NULL,
  authorized_by TEXT NOT NULL,
  review_note TEXT,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  revoke_reason TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_authorization_per_request
  ON authorizations(request_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES requests(id),
  authorization_id INTEGER NOT NULL REFERENCES authorizations(id),
  mode TEXT NOT NULL CHECK (mode IN ('simulated','mainnet')),
  status TEXT NOT NULL CHECK (status IN ('preparing','signed','sent','confirmed','failed','uncertain')),
  from_address TEXT,
  nonce INTEGER,
  raw_tx TEXT,
  tx_hash TEXT,
  block_number INTEGER,
  attribution_ok INTEGER,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS one_live_payment_per_request
  ON payments(request_id) WHERE status <> 'failed';

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  request_id INTEGER,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);

-- Wallet de cobro del colaborador (piloto: un solo colaborador). La define el propio colaborador.
CREATE TABLE IF NOT EXISTS collaborator_profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  wallet TEXT NOT NULL,
  name TEXT,
  updated_at TEXT NOT NULL
);

-- Configuración del agente que define el organizador (se puede cambiar en cualquier momento).
-- auto_pay_limit_cents: hasta ese monto (inclusive) el agente paga solo los gastos sin alertas. 0 = apagado.
CREATE TABLE IF NOT EXISTS agent_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  auto_pay_limit_cents INTEGER NOT NULL CHECK (auto_pay_limit_cents >= 0),
  -- Tope de lo que el agente puede autorizar solo en 24 h. NULL = automático (3 veces el límite por gasto).
  auto_pay_daily_cap_cents INTEGER CHECK (auto_pay_daily_cap_cents >= 0),
  updated_at TEXT NOT NULL
);
`;

export function openDb(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  // Columnas agregadas después de la primera versión: se suman a bases existentes sin borrar datos.
  ensureColumn(db, "requests", "claimant_name", "TEXT");
  ensureColumn(db, "collaborator_profile", "name", "TEXT");
  ensureColumn(db, "agent_settings", "auto_pay_daily_cap_cents", "INTEGER");
  return db;
}

function ensureColumn(db: DB, table: string, column: string, type: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

/**
 * Corre fn dentro de BEGIN IMMEDIATE (toma el lock de escritura al empezar).
 * fn tiene que ser sincrónica: nada de await adentro, así ninguna otra operación
 * se intercala entre el chequeo y la escritura.
 */
export function tx<T>(db: DB, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    if (out instanceof Promise) throw new Error("tx(): la función no puede ser async");
    db.exec("COMMIT");
    return out;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
