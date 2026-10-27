// Singletons del servidor Next: DB, comprobantes, analizador, herramienta de pago, cliente de Celo.
import { openPglite, openPostgres, type DB } from "./db.ts";
import { readConfig, type AppConfig } from "./config.ts";
import { createFakeAnalyzer, createRealAnalyzer, type Analyzer } from "./agent/analyze.ts";
import { createRealChain, type ChainClient } from "./chain/clients.ts";
import { createPayTool, type PayTool } from "./chain/payTool.ts";
import { getAgentAccount } from "./chain/signer.ts";
import { createFsReceiptStore, createSupabaseReceiptStore, type ReceiptStore } from "./receipts.ts";
import { createLocalIdentity, createSupabaseIdentity, type IdentityProvider } from "./identity.ts";
import type { AuthCtx } from "./members.ts";
import * as repo from "./repo.ts";
import { DEMO_CATEGORIES, DEMO_POLICY } from "./demo.ts";
import * as budgets from "./budgets.ts";
import type { Ctx } from "./workflow.ts";

interface Singletons {
  db?: Promise<DB>;
  dbKey?: string;
  receipts?: ReceiptStore;
  identity?: IdentityProvider;
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
  // Primera vez: política general y categorías de la demo para que la app arranque usable.
  // Los presupuestos los crea el organizador.
  if (!(await repo.getEvent(db)) || !(await budgets.listCategories(db)).length) {
    await db.tx(async (q) => {
      if (!(await repo.getEvent(q))) await repo.upsertEvent(q, DEMO_POLICY);
      if (!(await budgets.listCategories(q)).length) for (const c of DEMO_CATEGORIES) await budgets.upsertCategory(q, c);
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

/** Supabase Auth si hay Supabase configurado; si no, el proveedor local (solo desarrollo). */
export async function identity(): Promise<IdentityProvider> {
  if (S.identity) return S.identity;
  const cfg = config();
  if (cfg.supabaseUrl && cfg.supabaseSecretKey) {
    S.identity = createSupabaseIdentity({ url: cfg.supabaseUrl, secretKey: cfg.supabaseSecretKey });
  } else {
    if (cfg.onVercel) throw new ConfigError("Faltan SUPABASE_URL y SUPABASE_SECRET_KEY: en Vercel las cuentas van a Supabase Auth.");
    S.identity = createLocalIdentity(await db());
  }
  return S.identity;
}

export async function authCtx(): Promise<AuthCtx> {
  return { ...(await ctx()), identity: await identity(), ownerEmail: config().ownerEmail };
}

export function analyzer(): Analyzer {
  const cfg = config();
  return cfg.aiMode === "fake" ? createFakeAnalyzer() : createRealAnalyzer(cfg.ai);
}

export async function ctx(): Promise<Ctx> {
  return { db: await db(), receipts: receipts(), analyzer: analyzer(), paymentMode: config().paymentMode };
}

export function chain(): ChainClient {
  return (S.chain ??= createRealChain());
}

export async function payTool(): Promise<PayTool> {
  const cfg = config();
  if (cfg.paymentMode === "mainnet") {
    return createPayTool({ db: await db(), mode: "mainnet", chain: chain(), account: getAgentAccount(), aiMode: cfg.aiMode });
  }
  return createPayTool({ db: await db(), mode: "simulated", account: null });
}
