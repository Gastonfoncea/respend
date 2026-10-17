// Singletons del servidor Next: DB, analizador, herramienta de pago, cliente de Celo.
import { openDb, type DB } from "./db.ts";
import { readConfig, type AppConfig } from "./config.ts";
import { createFakeAnalyzer, createRealAnalyzer, type Analyzer } from "./agent/analyze.ts";
import { createRealChain, type ChainClient } from "./chain/clients.ts";
import { createPayTool, type PayTool } from "./chain/payTool.ts";
import { getAgentAccount } from "./chain/signer.ts";
import * as repo from "./repo.ts";
import { DEMO_POLICY } from "./demo.ts";
import type { Ctx } from "./workflow.ts";

interface Singletons {
  db?: DB;
  dbPath?: string;
  chain?: ChainClient;
}

const g = globalThis as unknown as { __respend?: Singletons };
const S: Singletons = (g.__respend ??= {});

export function config(): AppConfig {
  return readConfig();
}

export function db(): DB {
  const cfg = config();
  if (!S.db || S.dbPath !== cfg.dbPath) {
    S.db = openDb(cfg.dbPath);
    S.dbPath = cfg.dbPath;
    // Primera vez: crear el evento de demo para que la app arranque usable.
    if (!repo.getEvent(S.db)) repo.upsertEvent(S.db, DEMO_POLICY);
  }
  return S.db;
}

export function analyzer(): Analyzer {
  const cfg = config();
  return cfg.aiMode === "fake" ? createFakeAnalyzer() : createRealAnalyzer(cfg.ai);
}

export function ctx(): Ctx {
  return { db: db(), receiptsDir: config().receiptsDir, analyzer: analyzer() };
}

export function chain(): ChainClient {
  return (S.chain ??= createRealChain());
}

export function payTool(): PayTool {
  const cfg = config();
  if (cfg.paymentMode === "mainnet") {
    return createPayTool({ db: db(), mode: "mainnet", chain: chain(), account: getAgentAccount() });
  }
  return createPayTool({ db: db(), mode: "simulated", account: null });
}
