// Singletons del servidor Next: DB, comprobantes, analizador, herramienta de pago, cliente de Celo.
import { openPglite, openPostgres, type DB } from "./db.ts";
import { readConfig, type AppConfig } from "./config.ts";
import { createFakeAnalyzer, createRealAnalyzer, type Analyzer } from "./agent/analyze.ts";
import { createRealChain, type ChainClient } from "./chain/clients.ts";
import { createPayTool, type PayTool } from "./chain/payTool.ts";
import { getAgentAccount } from "./chain/signer.ts";
import { createFsReceiptStore, createSupabaseReceiptStore, type ReceiptStore } from "./receipts.ts";
import * as repo from "./repo.ts";
import { DEMO_POLICY } from "./demo.ts";
import type { Ctx } from "./workflow.ts";

interface Singletons {
  db?: Promise<DB>;
  dbKey?: string;
  receipts?: ReceiptStore;
  chain?: ChainClient;
}

const g = globalThis as unknown as { __respend?: Singletons };
const S: Singletons = (g.__respend ??= {});

export class ConfigError extends Error {}

export function config(): AppConfig {
  return readConfig();
}

async function openConfiguredDb(cfg: AppConfig): Promise<DB> {
  let db: DB;
  if (cfg.databaseUrl) {
    db = openPostgres({ connectionString: cfg.databaseUrl, caCert: cfg.databaseCaCert });
  } else {
    if (cfg.onVercel) throw new ConfigError("Falta DATABASE_URL: en Vercel la base tiene que ser Postgres (Supabase).");
    db = await openPglite(cfg.pgliteDir);
  }
  // Primera vez: crear el evento de demo para que la app arranque usable.
  if (!(await repo.getEvent(db))) {
    await db.tx(async (q) => {
      if (!(await repo.getEvent(q))) await repo.upsertEvent(q, DEMO_POLICY);
    });
  }
  return db;
}

export function db(): Promise<DB> {
  const cfg = config();
  const key = cfg.databaseUrl ?? cfg.pgliteDir;
  if (!S.db || S.dbKey !== key) {
    S.dbKey = key;
    S.db = openConfiguredDb(cfg);
    // Si falla (por ejemplo, la base no responde), el próximo pedido vuelve a intentar.
    S.db.catch(() => {
      if (S.dbKey === key) S.db = undefined;
    });
  }
  return S.db;
}

export function receipts(): ReceiptStore {
  if (S.receipts) return S.receipts;
  const cfg = config();
  if (cfg.supabaseUrl && cfg.supabaseSecretKey) {
    S.receipts = createSupabaseReceiptStore({ url: cfg.supabaseUrl, secretKey: cfg.supabaseSecretKey, bucket: cfg.receiptsBucket });
  } else {
    if (cfg.onVercel) throw new ConfigError("Faltan SUPABASE_URL y SUPABASE_SECRET_KEY: en Vercel los comprobantes van a Supabase Storage.");
    S.receipts = createFsReceiptStore(cfg.receiptsDir);
  }
  return S.receipts;
}

export function analyzer(): Analyzer {
  const cfg = config();
  return cfg.aiMode === "fake" ? createFakeAnalyzer() : createRealAnalyzer(cfg.ai);
}

export async function ctx(): Promise<Ctx> {
  return { db: await db(), receipts: receipts(), analyzer: analyzer() };
}

export function chain(): ChainClient {
  return (S.chain ??= createRealChain());
}

export async function payTool(): Promise<PayTool> {
  const cfg = config();
  if (cfg.paymentMode === "mainnet") {
    return createPayTool({ db: await db(), mode: "mainnet", chain: chain(), account: getAgentAccount() });
  }
  return createPayTool({ db: await db(), mode: "simulated", account: null });
}
