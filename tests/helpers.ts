// Utilidades de test: DB temporal, sesiones, analizador falso programable, PNG mínimos.
import { after } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { openPglite, type DB, type PgliteDB } from "../lib/db.ts";
import { createFsReceiptStore } from "../lib/receipts.ts";
import { createLocalIdentity } from "../lib/identity.ts";
import type { AuthCtx } from "../lib/members.ts";
import * as repo from "../lib/repo.ts";
import { DEMO_BUDGET, DEMO_CATEGORIES, DEMO_POLICY } from "../lib/demo.ts";
import * as budgets from "../lib/budgets.ts";
import type { Ctx } from "../lib/workflow.ts";
import type { Analyzer } from "../lib/agent/analyze.ts";
import type { AiOutput } from "../lib/agent/prompt.ts";
import type { Session } from "../lib/types.ts";

// Direcciones de ejemplo del estándar EIP-55. Los tests nunca pagan en una red real (cadena falsa).
export const RECIPIENT = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";

// La base modelo trae estos dos miembros (ids 1 y 2): un organizador y un colaborador con wallet RECIPIENT.
export const ORG_ID = 1;
export const COLLAB_ID = 2;
/** El presupuesto de la demo (DEMO_BUDGET): 10 al 18/10/2026, pago automático hasta $ 100. */
export const BUDGET_ID = 1;
export const ORG: Session = { memberId: ORG_ID, role: "organizer", name: "Ana Org", issuedAt: Date.now() };
export const COLLAB: Session = { memberId: COLLAB_ID, role: "collaborator", name: "Juan Colab", issuedAt: Date.now() };

export function aiOut(over: Partial<Omit<AiOutput, "extracted">> & { extracted?: Partial<AiOutput["extracted"]> } = {}): AiOutput {
  const { extracted, ...rest } = over;
  return {
    extracted: {
      date: "2026-10-15",
      merchant: "Remises del Centro SRL",
      concept: "Viaje",
      amount: "1500.00",
      currency: "ARS",
      legibility: "good",
      ...extracted,
    },
    category: "transporte",
    category_reasoning: "transporte",
    missing_info: [],
    clarification_questions: [],
    suspicious_instructions: [],
    recommendation: "approve",
    explanation: "ok",
    evidence: [],
    ...rest,
  };
}

/** Analizador falso: devuelve lo que diga `pick` según la descripción. */
export function scriptedAnalyzer(pick: (description: string) => AiOutput): Analyzer {
  // fake: false → se comporta como un análisis con IA real (si no, en mainnet el pago se bloquea).
  return async (input) => ({ ok: true, output: pick(input.description), model: "test", provider: "test", fake: false });
}

export function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "respend-test-"));
}

// Bases abiertas en este archivo de tests: se cierran al terminar, si no el proceso no sale.
const openDbs: PgliteDB[] = [];
after(async () => {
  await Promise.all(openDbs.splice(0).map((db) => db.close().catch(() => {})));
  if (templateDb) await (await templateDb).close().catch(() => {});
});

// Base modelo (migrada y con el evento de demo): cada test usa una copia, que es mucho más rápido que migrar de cero.
let templateDb: Promise<PgliteDB> | null = null;
function template(): Promise<PgliteDB> {
  return (templateDb ??= (async () => {
    const db = await openPglite();
    await repo.upsertEvent(db, DEMO_POLICY);
    await repo.insertMember(db, { email: "ana@equipo.test", name: ORG.name, role: "organizer", wallet: null });
    await repo.insertMember(db, { email: "juan@equipo.test", name: COLLAB.name, role: "collaborator", wallet: RECIPIENT });
    for (const c of DEMO_CATEGORIES) await budgets.upsertCategory(db, c);
    await budgets.insertBudget(db, { ...DEMO_BUDGET, createdBy: ORG_ID });
    // Asignación "sin categoría" del colaborador por todo el presupuesto total: los tests de antes siguen igual.
    await budgets.upsertAssignment(db, { budgetId: BUDGET_ID, memberId: COLLAB_ID, categoryKey: null, amountCents: DEMO_POLICY.budgetCents, by: ORG_ID });
    return db;
  })());
}

export type TestCtx = AuthCtx & { dir: string };

/** Cambia el máximo por ticket del pago automático del presupuesto de la demo (0 = apagado). */
export async function setAutoPayMax(db: DB, cents: number): Promise<void> {
  await db.query("UPDATE budgets SET autopay_max_per_receipt_cents = $1 WHERE id = $2", [cents, BUDGET_ID]);
}

/** Política de evaluación de la demo (la general + el presupuesto de la demo + sus categorías). */
export const DEMO_EVAL_POLICY = {
  ...DEMO_POLICY,
  version: 1,
  budgetId: BUDGET_ID,
  startDate: DEMO_BUDGET.startsOn,
  endDate: DEMO_BUDGET.endsOn,
  categories: DEMO_CATEGORIES.map((c) => c.key),
  categoryInfo: DEMO_CATEGORIES.map(({ key, name, description }) => ({ key, name, description })),
};

/** Contexto de test: Postgres en memoria (PGlite) con las migraciones de supabase/migrations y comprobantes en una carpeta temporal. */
export async function makeCtx(analyzer: Analyzer = scriptedAnalyzer(() => aiOut()), dir = tmpDir()): Promise<TestCtx> {
  const db = await (await template()).clone();
  openDbs.push(db);
  return { db, receipts: createFsReceiptStore(path.join(dir, "receipts")), analyzer, dir, identity: createLocalIdentity(db) };
}

/**
 * "Reinicio" del proceso: otra instancia de la herramienta sobre la misma base. PGlite en memoria es una
 * sola conexión, así que devuelve la misma DB; lo que importa es que no quede estado en memoria del proceso.
 */
export function reopen(ctx: { db: DB }): DB {
  return ctx.db;
}

let crcTable: number[] | null = null;
function crc32(buf: Buffer): number {
  if (!crcTable) {
    crcTable = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** PNG válido de 1×1 cuyo color depende de `seed` (para tener archivos distintos). */
export function tinyPng(seed: number): Uint8Array {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.from([0, seed & 0xff, (seed >> 8) & 0xff, (seed >> 16) & 0xff]);
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", zlib.deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}
