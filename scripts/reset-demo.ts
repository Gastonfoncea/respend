// Borra los datos (solicitudes, pagos, auditoría) y recrea el evento con la política de demo.
// Se niega si hay pagos en mainnet registrados, salvo --force (perderías el registro de esos pagos).
// Con DATABASE_URL apunta a Postgres (Supabase): ahí además exige --remote, para no borrar producción por error.
// Los comprobantes de Supabase Storage no se borran (se llaman por su sha256 y no molestan).
import fs from "node:fs";
import { readConfig } from "../lib/config.ts";
import { openPglite, openPostgres } from "../lib/db.ts";
import * as repo from "../lib/repo.ts";
import { DEMO_POLICY } from "../lib/demo.ts";
import { normalizeRecipient } from "../lib/policy.ts";

const cfg = readConfig();
const force = process.argv.includes("--force");
const where = cfg.databaseUrl ? "Postgres (DATABASE_URL)" : cfg.pgliteDir;
if (cfg.databaseUrl && !process.argv.includes("--remote")) {
  console.error("DATABASE_URL apunta a Postgres remoto. Si de verdad querés borrar esa base, agregá --remote.");
  process.exit(1);
}

const db = cfg.databaseUrl ? openPostgres({ connectionString: cfg.databaseUrl, caCert: cfg.databaseCaCert, max: 1 }) : await openPglite(cfg.pgliteDir);
try {
  const [{ n }] = await db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM payments WHERE mode = 'mainnet'");
  if (n > 0 && !force) {
    console.error(`Hay ${n} pago(s) en mainnet registrados en ${where}. Hacé una copia y usá --force si querés borrar igual.`);
    process.exit(1);
  }
  const demoWallet = cfg.demoCollaboratorAddress ? normalizeRecipient(cfg.demoCollaboratorAddress) : null;
  await db.tx(async (q) => {
    await q.query(
      "TRUNCATE payments, authorizations, clarifications, audit_log, requests, event, collaborator_profile, agent_settings RESTART IDENTITY",
    );
    await repo.upsertEvent(q, DEMO_POLICY);
    // Wallet de cobro del colaborador de demo, si está en el entorno (el colaborador la puede cambiar desde "Mi perfil").
    if (demoWallet) await repo.setCollaboratorProfile(q, { name: null, wallet: demoWallet });
  });
  if (!cfg.supabaseUrl) fs.rmSync(cfg.receiptsDir, { recursive: true, force: true });
  console.log(`Datos borrados en ${where}. Evento "${DEMO_POLICY.name}" creado con la política de demo.${demoWallet ? ` Wallet del colaborador: ${demoWallet}.` : ""}`);
} finally {
  await db.close();
}
