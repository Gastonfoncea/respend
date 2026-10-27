// Quién es quién: guarda y verifica contraseñas. En producción lo hace Supabase Auth (con la clave secreta,
// solo del lado del servidor). En tests y desarrollo, un proveedor local con scrypt sobre la misma base.
// La app no guarda contraseñas propias en producción: solo el id del usuario de Auth (members.auth_user_id).
import { randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";
import type { Queryable } from "./db.ts";
import { nowIso } from "./db.ts";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export class IdentityError extends Error {}

export interface IdentityProvider {
  readonly kind: "supabase" | "local";
  /** Crea el usuario y devuelve su id. Falla si el mail ya tiene cuenta. */
  createUser(email: string, password: string): Promise<string>;
  /** Id del usuario si la contraseña es correcta; null si no. */
  verifyPassword(email: string, password: string): Promise<string | null>;
  deleteUser(userId: string): Promise<void>;
}

export const MIN_PASSWORD = 8;

// --- Supabase Auth ---

export function createSupabaseIdentity(opts: { url: string; secretKey: string }): IdentityProvider {
  // Un cliente por llamada: signInWithPassword guarda la sesión en el cliente y no queremos compartirla.
  const client = () => createClient(opts.url, opts.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    kind: "supabase",
    async createUser(email, password) {
      const { data, error } = await client().auth.admin.createUser({ email, password, email_confirm: true });
      if (error || !data.user) {
        if (/registered|exists|already/i.test(error?.message ?? "")) throw new IdentityError("Ese mail ya tiene una cuenta.");
        throw new IdentityError(`No se pudo crear la cuenta: ${error?.message ?? "sin respuesta"}`);
      }
      return data.user.id;
    },
    async verifyPassword(email, password) {
      const { data, error } = await client().auth.signInWithPassword({ email, password });
      if (error || !data.user) return null;
      return data.user.id;
    },
    async deleteUser(userId) {
      const { error } = await client().auth.admin.deleteUser(userId);
      if (error && !/not.?found/i.test(error.message)) throw new IdentityError(`No se pudo borrar la cuenta: ${error.message}`);
    },
  };
}

// --- Local (tests y desarrollo sin Supabase) ---

async function hashPassword(password: string, salt = randomBytes(16)): Promise<string> {
  const key = await scrypt(password, salt, 32);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

async function checkHash(password: string, stored: string): Promise<boolean> {
  const [, salt, key] = stored.split("$");
  if (!salt || !key) return false;
  const got = await scrypt(password, Buffer.from(salt, "base64"), 32);
  const want = Buffer.from(key, "base64");
  return got.length === want.length && timingSafeEqual(got, want);
}

export function createLocalIdentity(db: Queryable): IdentityProvider {
  let ready: Promise<unknown> | null = null;
  const init = () =>
    (ready ??= db.query(
      "CREATE TABLE IF NOT EXISTS local_identities (user_id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL)",
    ));
  return {
    kind: "local",
    async createUser(email, password) {
      await init();
      const exists = await db.query("SELECT 1 FROM local_identities WHERE email = $1", [email]);
      if (exists.length) throw new IdentityError("Ese mail ya tiene una cuenta.");
      const id = randomUUID();
      await db.query("INSERT INTO local_identities (user_id, email, password_hash, created_at) VALUES ($1, $2, $3, $4)", [
        id,
        email,
        await hashPassword(password),
        nowIso(),
      ]);
      return id;
    },
    async verifyPassword(email, password) {
      await init();
      const [row] = await db.query<{ user_id: string; password_hash: string }>("SELECT user_id, password_hash FROM local_identities WHERE email = $1", [email]);
      // Sin usuario igual se calcula un hash, para no delatar por el tiempo qué mails tienen cuenta.
      const ok = await checkHash(password, row?.password_hash ?? (await hashPassword("x")));
      return row && ok ? row.user_id : null;
    },
    async deleteUser(userId) {
      await init();
      await db.query("DELETE FROM local_identities WHERE user_id = $1", [userId]);
    },
  };
}
