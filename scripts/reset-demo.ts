// Borra los datos (solicitudes, pagos, auditoría) y recrea el evento con la política de demo.
// Se niega si hay pagos en mainnet registrados, salvo --force (perderías el registro de esos pagos).
// Con DATABASE_URL apunta a Postgres (Supabase): ahí además exige --remote, para no borrar producción por error.
// Los comprobantes de Supabase Storage no se borran (se llaman por su sha256 y no molestan).
// El equipo (members) y sus cuentas se conservan: borrarlos dejaría usuarios huérfanos en Supabase Auth.
import fs from "node:fs";
import { readConfig } from "../lib/config.ts";
import { openPglite, openPostgres } from "../lib/db.ts";
import * as repo from "../lib/repo.ts";
import { DEMO_BUDGET, DEMO_CATEGORIES, DEMO_POLICY } from "../lib/demo.ts";
import * as budgets from "../lib/budgets.ts";

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
  await db.tx(async (q) => {
    await q.query(
      "TRUNCATE payments, authorizations, clarifications, audit_log, requests, assignments, budgets, event, agent_settings RESTART IDENTITY",
    );
    await repo.upsertEvent(q, DEMO_POLICY);
    for (const c of DEMO_CATEGORIES) await budgets.upsertCategory(q, c);
    await budgets.insertBudget(q, { ...DEMO_BUDGET, createdBy: null });
  });
  if (!cfg.supabaseUrl) fs.rmSync(cfg.receiptsDir, { recursive: true, force: true });
  console.log(`Datos borrados en ${where}. Política, categorías y presupuesto "${DEMO_BUDGET.name}" de demo creados. El equipo se conservó; las asignaciones se cargan en Presupuestos.`);
} finally {
  await db.close();
}
