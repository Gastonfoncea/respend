// Configuración: constantes de red/token (verificadas en PLAN.md §2) y lectura de entorno.
// Este archivo NO lee AGENT_PRIVATE_KEY: eso vive solo en lib/chain/signer.ts.
import path from "node:path";

export const CHAIN_ID = 42220;
export const RPC_URL = "https://forno.celo.org";
export const EXPLORER_URL = "https://celoscan.io";

export const WARS_ADDRESS = "0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D" as const;
export const WARS_SYMBOL = "wARS";
export const WARS_DECIMALS = 18;
/** 1 ARS = 1 wARS nominal: wei = centavos × 10^16. */
export const WEI_PER_CENT = 10n ** 16n;

export const ATTRIBUTION_REPO = "gastonfoncea/respend";
export const ATTRIBUTION_CODE = "celo_e418a350ffec";

export const IDENTITY_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as const;
export const REPUTATION_REGISTRY = "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63" as const;

export const MAX_RECEIPT_BYTES = 4 * 1024 * 1024;
export const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"] as const;

export type PaymentMode = "simulated" | "mainnet";
export type AiMode = "real" | "fake";
export type AiProvider = "gateway" | "openai" | "custom" | "none";

export interface AiConfig {
  provider: AiProvider;
  baseUrl: string;
  model: string;
  /** La key nunca se loguea ni se muestra. */
  apiKey: string | null;
  /** Nombre de la variable que falta, para el mensaje de la UI. */
  missingKeyVar: string | null;
}

export interface AppConfig {
  paymentMode: PaymentMode;
  aiMode: AiMode;
  ai: AiConfig;
  sessionSecret: string | null;
  /** Opcional: si está, solo ese mail puede crear la primera cuenta (la del organizador). */
  ownerEmail: string | null;
  dataDir: string;
  /** Postgres (Supabase). Sin esto se usa PGlite local en `pgliteDir` (solo desarrollo). */
  databaseUrl: string | null;
  /** CA de Supabase en PEM, para verificar el certificado del servidor de Postgres. */
  databaseCaCert: string | null;
  pgliteDir: string;
  /** Supabase Storage. Sin URL o clave, los comprobantes van a `receiptsDir` (solo desarrollo). */
  supabaseUrl: string | null;
  supabaseSecretKey: string | null;
  receiptsBucket: string;
  receiptsDir: string;
  /** Corre en Vercel: ahí no hay disco persistente, así que Postgres y Storage son obligatorios. */
  onVercel: boolean;
  demoCollaboratorAddress: string | null;
}

type Env = Record<string, string | undefined>;

function nonEmpty(v: string | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

export function readAiConfig(env: Env = process.env): AiConfig {
  const gatewayKey = nonEmpty(env.AI_GATEWAY_API_KEY);
  const openaiKey = nonEmpty(env.OPENAI_API_KEY);
  const baseOverride = nonEmpty(env.AI_BASE_URL);
  const modelOverride = nonEmpty(env.AI_MODEL);

  let provider: AiProvider;
  let baseUrl: string;
  let model: string;
  let apiKey: string | null;
  if (gatewayKey) {
    provider = "gateway";
    baseUrl = "https://ai-gateway.vercel.sh/v1";
    model = "openai/gpt-5.4-mini";
    apiKey = gatewayKey;
  } else if (openaiKey) {
    provider = "openai";
    baseUrl = "https://api.openai.com/v1";
    model = "gpt-5.4-mini";
    apiKey = openaiKey;
  } else {
    provider = "none";
    baseUrl = "https://ai-gateway.vercel.sh/v1";
    model = "openai/gpt-5.4-mini";
    apiKey = null;
  }
  if (baseOverride) {
    baseUrl = baseOverride;
    if (provider !== "none") provider = "custom";
  }
  if (modelOverride) model = modelOverride;
  return {
    provider,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    model,
    apiKey,
    missingKeyVar: apiKey ? null : "AI_GATEWAY_API_KEY",
  };
}

export function readConfig(env: Env = process.env): AppConfig {
  const paymentMode: PaymentMode = env.PAYMENT_MODE === "mainnet" ? "mainnet" : "simulated";
  const aiMode: AiMode = env.AI_MODE === "fake" ? "fake" : "real";
  const dataDir = path.resolve(/*turbopackIgnore: true*/ nonEmpty(env.DATA_DIR) ?? path.join(process.cwd(), "data"));
  return {
    paymentMode,
    aiMode,
    ai: readAiConfig(env),
    sessionSecret: nonEmpty(env.SESSION_SECRET),
    ownerEmail: nonEmpty(env.OWNER_EMAIL),
    dataDir,
    databaseUrl: nonEmpty(env.DATABASE_URL),
    databaseCaCert: nonEmpty(env.DATABASE_CA_CERT)?.replace(/\\n/g, "\n") ?? null,
    pgliteDir: path.join(dataDir, "pglite"),
    supabaseUrl: nonEmpty(env.SUPABASE_URL),
    supabaseSecretKey: nonEmpty(env.SUPABASE_SECRET_KEY),
    receiptsBucket: nonEmpty(env.SUPABASE_RECEIPTS_BUCKET) ?? "tickets",
    receiptsDir: path.join(dataDir, "receipts"),
    onVercel: Boolean(env.VERCEL),
    demoCollaboratorAddress: nonEmpty(env.DEMO_COLLABORATOR_ADDRESS),
  };
}

export function txUrl(hash: string): string {
  return `${EXPLORER_URL}/tx/${hash}`;
}

export function addressUrl(addr: string): string {
  return `${EXPLORER_URL}/address/${addr}`;
}
