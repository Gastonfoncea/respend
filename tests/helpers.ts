// Utilidades de test: DB temporal, sesiones, analizador falso programable, PNG mínimos.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { openDb, type DB } from "../lib/db.ts";
import * as repo from "../lib/repo.ts";
import { DEMO_POLICY } from "../lib/demo.ts";
import type { Ctx } from "../lib/workflow.ts";
import type { Analyzer } from "../lib/agent/analyze.ts";
import type { AiOutput } from "../lib/agent/prompt.ts";
import type { Session } from "../lib/types.ts";

export const ORG: Session = { role: "organizer", issuedAt: Date.now() };
export const COLLAB: Session = { role: "collaborator", issuedAt: Date.now() };
export const RECIPIENT = "0x1111111111111111111111111111111111111111";

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
  return async (input) => ({ ok: true, output: pick(input.description), model: "test", provider: "test", fake: true });
}

export function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "respend-test-"));
}

export function makeCtx(analyzer: Analyzer = scriptedAnalyzer(() => aiOut()), dir = tmpDir()): Ctx & { dir: string; dbPath: string } {
  const dbPath = path.join(dir, "respend.db");
  const db = openDb(dbPath);
  if (!repo.getEvent(db)) repo.upsertEvent(db, DEMO_POLICY);
  return { db, receiptsDir: path.join(dir, "receipts"), analyzer, dir, dbPath };
}

export function reopen(ctx: { dbPath: string }): DB {
  return openDb(ctx.dbPath);
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
