// Borra los datos locales (DB + comprobantes) y recrea el evento con la política de demo.
// Se niega si hay pagos en mainnet registrados, salvo --force (perderías el registro de esos pagos).
import fs from "node:fs";
import { readConfig } from "../lib/config.ts";
import { openDb } from "../lib/db.ts";
import * as repo from "../lib/repo.ts";
import { DEMO_POLICY } from "../lib/demo.ts";
import { normalizeRecipient } from "../lib/policy.ts";

const cfg = readConfig();
if (fs.existsSync(cfg.dbPath) && !process.argv.includes("--force")) {
  const db = openDb(cfg.dbPath);
  const n = (db.prepare("SELECT COUNT(*) AS n FROM payments WHERE mode = 'mainnet'").get() as { n: number }).n;
  db.close();
  if (n > 0) {
    console.error(`Hay ${n} pago(s) en mainnet registrados en ${cfg.dbPath}. Hacé una copia y usá --force si querés borrar igual.`);
    process.exit(1);
  }
}
for (const f of [cfg.dbPath, `${cfg.dbPath}-wal`, `${cfg.dbPath}-shm`]) fs.rmSync(f, { force: true });
fs.rmSync(cfg.receiptsDir, { recursive: true, force: true });
const db = openDb(cfg.dbPath);
repo.upsertEvent(db, DEMO_POLICY);
// Wallet de cobro del colaborador de demo, si está en el entorno (el colaborador la puede cambiar desde "Mi wallet").
const demoWallet = cfg.demoCollaboratorAddress ? normalizeRecipient(cfg.demoCollaboratorAddress) : null;
if (demoWallet) repo.setCollaboratorWallet(db, demoWallet);
db.close();
console.log(`Datos borrados en ${cfg.dataDir}. Evento "${DEMO_POLICY.name}" creado con la política de demo.${demoWallet ? ` Wallet del colaborador: ${demoWallet}.` : ""}`);
