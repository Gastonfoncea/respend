// Postgres: Supabase en producción (pg), PGlite en tests y en desarrollo local sin DATABASE_URL.
// Todas las escrituras corren en tx(), que toma un lock global de escritura (como BEGIN IMMEDIATE en SQLite).
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import type { PGlite } from "@electric-sql/pglite";

export type Row = Record<string, unknown>;

/** Algo contra lo que se puede consultar: la base o una transacción abierta. */
export interface Queryable {
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface DB extends Queryable {
  readonly kind: "postgres" | "pglite";
  /**
   * Corre fn en una transacción que toma primero el lock global de escritura (pg_advisory_xact_lock).
   * Dos tx() nunca se intercalan, así ningún chequeo (presupuesto, pago en curso) queda viejo antes de escribir.
   * Adentro, usar SIEMPRE el `q` que recibe fn, nunca la base: otra conexión no ve lo no commiteado.
   */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Clave del lock de escritura ("resp" en ASCII). Cualquier número fijo sirve: lo comparten todas las instancias. */
const WRITE_LOCK_KEY = 0x72657370;

export function tx<T>(db: DB, fn: (q: Queryable) => Promise<T>): Promise<T> {
  return db.tx(fn);
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** BIGINT (int8) → number. Los centavos son enteros seguros de JS; si no lo son, mejor fallar que redondear. */
export function parseInt8(v: string): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error(`Entero fuera de rango seguro: ${v}`);
  return n;
}

const INT8_OID = 20;

// --- Postgres (Supabase) ---

export interface PostgresOptions {
  connectionString: string;
  /** Certificado de la CA de Supabase (PEM). Si está, se verifica el certificado del servidor. */
  caCert?: string | null;
  max?: number;
}

export function openPostgres(opts: PostgresOptions): DB {
  const url = new URL(opts.connectionString);
  // El SSL lo configuramos acá; sslmode en la URL pisaría estas opciones.
  url.searchParams.delete("sslmode");
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (!local && !opts.caCert) {
    // Cifrado igual, pero sin verificar quién responde. Para producción, cargar DATABASE_CA_CERT.
    console.warn("[db] DATABASE_CA_CERT vacía: la conexión a Postgres va cifrada pero sin verificar el certificado.");
  }
  const pool = new pg.Pool({
    connectionString: url.toString(),
    max: opts.max ?? 5,
    idleTimeoutMillis: 10_000,
    ssl: local ? false : opts.caCert ? { ca: opts.caCert, rejectUnauthorized: true } : { rejectUnauthorized: false },
    types: {
      getTypeParser: ((oid: number, format?: "text" | "binary") =>
        oid === INT8_OID ? parseInt8 : pg.types.getTypeParser(oid, format as "text")) as typeof pg.types.getTypeParser,
    },
  });
  const run = async <T>(c: pg.Pool | pg.PoolClient, sql: string, params?: unknown[]): Promise<T[]> =>
    (await c.query(sql, params as unknown[])).rows as T[];

  return {
    kind: "postgres",
    query: (sql, params) => run(pool, sql, params),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock($1)", [WRITE_LOCK_KEY]);
        const out = await fn({ query: (sql, params) => run(client, sql, params) });
        await client.query("COMMIT");
        return out;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

// --- PGlite (tests y desarrollo local) ---

export type PgliteDB = DB & {
  /** Copia en memoria de la base, con datos incluidos (tests: más rápido que abrir y migrar otra). */
  clone(): Promise<PgliteDB>;
};

/** `dataDir` null = en memoria. Aplica las migraciones de supabase/migrations que falten. */
export async function openPglite(dataDir: string | null = null): Promise<PgliteDB> {
  const { PGlite } = await import("@electric-sql/pglite");
  if (dataDir) fs.mkdirSync(dataDir, { recursive: true });
  const pgl: PGlite = new PGlite(dataDir ?? undefined, { parsers: { [INT8_OID]: parseInt8 } });
  await pgl.waitReady;
  await migratePglite(pgl);
  return wrapPglite(pgl);
}

function wrapPglite(pgl: PGlite): PgliteDB {
  return {
    kind: "pglite",
    clone: async () => wrapPglite((await pgl.clone()) as PGlite),
    query: async (sql, params) => (await pgl.query(sql, params)).rows as never,
    tx: (fn) =>
      pgl.transaction(async (t) => {
        await t.query("SELECT pg_advisory_xact_lock($1)", [WRITE_LOCK_KEY]);
        return fn({ query: async (sql, params) => (await t.query(sql, params)).rows as never });
      }),
    close: () => pgl.close(),
  };
}

export const MIGRATIONS_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), "supabase", "migrations");

/** Archivos de migración en orden. En Supabase se aplican con el MCP o `supabase db push`, no desde la app. */
export function migrationFiles(dir = MIGRATIONS_DIR): { name: string; sql: string }[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: fs.readFileSync(path.join(/*turbopackIgnore: true*/ dir, name), "utf8") }));
}

async function migratePglite(pgl: PGlite): Promise<void> {
  await pgl.exec("CREATE TABLE IF NOT EXISTS _local_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const done = new Set((await pgl.query<{ name: string }>("SELECT name FROM _local_migrations")).rows.map((r) => r.name));
  for (const m of migrationFiles()) {
    if (done.has(m.name)) continue;
    await pgl.transaction(async (t) => {
      await t.exec(m.sql); // exec acepta varias sentencias
      await t.query("INSERT INTO _local_migrations (name, applied_at) VALUES ($1, $2)", [m.name, nowIso()]);
    });
  }
}
