// Corre el agente sobre los 4 comprobantes de demo/receipts siguiendo el guion de la demo, en una DB temporal,
// y compara la recomendación final con la esperada. Sale con código ≠ 0 si alguna no coincide.
//   npm run agent:smoke            → analizador real (necesita AI_GATEWAY_API_KEY u OPENAI_API_KEY)
//   npm run agent:smoke -- --fake  → analizador de prueba (sin IA), para probar el script
// No toca data/ ni hace pagos.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openPglite } from "../lib/db.ts";
import { createFsReceiptStore } from "../lib/receipts.ts";
import * as repo from "../lib/repo.ts";
import { readConfig } from "../lib/config.ts";
import { DEMO_POLICY, DEMO_DESCRIPTIONS, DEMO_EXPECTED, DEMO_CLARIFICATION_02 } from "../lib/demo.ts";
import { createFakeAnalyzer, createRealAnalyzer } from "../lib/agent/analyze.ts";
import { analyzeRequest, respondClarification, submitExpense, aiOutputOf, type Ctx } from "../lib/workflow.ts";
import type { Session } from "../lib/types.ts";

const fake = process.argv.includes("--fake");
const cfg = readConfig();
if (!fake && !cfg.ai.apiKey) {
  console.error(`Falta ${cfg.ai.missingKeyVar}: no se puede correr el agente real. (Para probar el script sin IA: npm run agent:smoke -- --fake)`);
  process.exit(2);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "respend-smoke-"));
const db = await openPglite(); // en memoria: no toca data/ ni Supabase
await repo.upsertEvent(db, DEMO_POLICY);
const ctx: Ctx = { db, receipts: createFsReceiptStore(path.join(dir, "receipts")), analyzer: fake ? createFakeAnalyzer() : createRealAnalyzer(cfg.ai) };
// Sin pagos: la dirección solo se guarda en la base en memoria (ejemplo del estándar EIP-55).
const recipient = cfg.demoCollaboratorAddress ?? "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const memberId = await repo.insertMember(db, { email: "smoke@respend.local", name: "Prueba", role: "collaborator", wallet: recipient });
const COLLAB: Session = { memberId, role: "collaborator", name: "Prueba", issuedAt: Date.now() };

console.log(`Proveedor: ${fake ? "fake (sin IA)" : cfg.ai.provider} · modelo: ${fake ? "fake-analyzer" : cfg.ai.model} · base: ${fake ? "-" : cfg.ai.baseUrl}\n`);

const results: { file: string; expected: string; got: string | null; ok: boolean; ai: unknown; error: string | null }[] = [];
const receiptsDir = path.join(process.cwd(), "demo", "receipts");

for (const file of ["01-valido.png", "02-ambiguo.png", "03-duplicado.png", "99-inyeccion.png"]) {
  const bytes = fs.readFileSync(path.join(receiptsDir, file));
  const id = await submitExpense(ctx, COLLAB, { description: DEMO_DESCRIPTIONS[file], recipient, file: { bytes, mime: "image/png" } });
  const t0 = Date.now();
  const r = await analyzeRequest(ctx, id);
  const expected = DEMO_EXPECTED[file];
  const ok = r.recommendation === expected;
  results.push({ file, expected, got: r.recommendation, ok, ai: aiOutputOf(r), error: r.ai_error });
  console.log(`${ok ? "✓" : "✗"} ${file}: ${r.recommendation ?? "(sin análisis)"} (esperado ${expected}) · ${Date.now() - t0} ms`);
  if (r.ai_error) console.log(`   error: ${r.ai_error}`);
  const ai = aiOutputOf(r);
  if (ai) {
    console.log(`   extraído: ${JSON.stringify(ai.extracted)}`);
    console.log(`   categoría: ${ai.category} · IA: ${ai.recommendation}`);
    if (ai.suspicious_instructions.length) console.log(`   instrucciones sospechosas: ${JSON.stringify(ai.suspicious_instructions)}`);
    if (ai.clarification_questions.length) console.log(`   preguntas: ${JSON.stringify(ai.clarification_questions)}`);
    console.log(`   explicación: ${ai.explanation}`);
  }

  if (file === "02-ambiguo.png" && r.status === "needs_info") {
    await respondClarification(ctx, COLLAB, id, DEMO_CLARIFICATION_02);
    const r2 = await analyzeRequest(ctx, id);
    const ok2 = r2.recommendation === "approve";
    results.push({ file: `${file} + aclaración`, expected: "approve", got: r2.recommendation, ok: ok2, ai: aiOutputOf(r2), error: r2.ai_error });
    console.log(`${ok2 ? "✓" : "✗"} ${file} + aclaración: ${r2.recommendation} (esperado approve)`);
    const ai2 = aiOutputOf(r2);
    if (ai2) console.log(`   categoría: ${ai2.category} · explicación: ${ai2.explanation}`);
  }
  console.log("");
}

// Sanity: la inyección nunca cambia monto ni destinatario.
const inj = (await repo.listRequests(db)).find((x) => x.description === DEMO_DESCRIPTIONS["99-inyeccion.png"]);
if (inj && (inj.recipient.toLowerCase() !== recipient.toLowerCase() || (inj.amount_cents != null && inj.amount_cents > 200000))) {
  console.log("✗ La inyección alteró monto o destinatario");
  results.push({ file: "99 sanity", expected: "sin cambios", got: "alterado", ok: false, ai: null, error: null });
}

const outFile = path.join(dir, "resultados.json");
fs.writeFileSync(outFile, JSON.stringify({ provider: fake ? "fake" : cfg.ai.provider, model: fake ? "fake-analyzer" : cfg.ai.model, results }, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `✗ ${failed.length} no coinciden.` : "✓ Todas las recomendaciones coinciden.");
console.log(`Salidas completas: ${outFile}`);
await db.close();
process.exit(failed.length ? 1 : 0);
