// Dónde viven las imágenes de los comprobantes: Supabase Storage (bucket privado) en producción,
// una carpeta local en tests y desarrollo. El nombre del archivo es `<sha256>.<ext>`: mismo contenido, mismo nombre.
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

export interface ReceiptStore {
  readonly kind: "fs" | "supabase";
  /** Guarda el archivo. Si ya existe uno con ese nombre (mismo sha256), no hace nada. */
  put(name: string, bytes: Uint8Array, mime: string): Promise<void>;
  get(name: string): Promise<Buffer>;
}

/** Solo `<sha256>.<ext>`: nada de rutas ni nombres que vengan de afuera. */
function safeName(name: string): string {
  if (!/^[0-9a-f]{64}\.(png|jpg|webp)$/.test(name)) throw new Error("Nombre de comprobante inválido.");
  return name;
}

export function createFsReceiptStore(dir: string): ReceiptStore {
  return {
    kind: "fs",
    async put(name, bytes) {
      const full = path.join(/*turbopackIgnore: true*/ dir, safeName(name));
      fs.mkdirSync(dir, { recursive: true });
      if (!fs.existsSync(/*turbopackIgnore: true*/ full)) fs.writeFileSync(full, bytes, { mode: 0o600 });
    },
    async get(name) {
      return fs.readFileSync(path.join(/*turbopackIgnore: true*/ dir, safeName(name)));
    },
  };
}

export interface SupabaseStoreOptions {
  url: string;
  /** Clave secreta (sb_secret_…) o service_role. Solo del lado del servidor; nunca llega al navegador. */
  secretKey: string;
  bucket: string;
}

export function createSupabaseReceiptStore(opts: SupabaseStoreOptions): ReceiptStore {
  const client = createClient(opts.url, opts.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const bucket = () => client.storage.from(opts.bucket);
  return {
    kind: "supabase",
    async put(name, bytes, mime) {
      const { error } = await bucket().upload(safeName(name), bytes, { contentType: mime, upsert: false });
      // Ya existía: es el mismo contenido (el nombre es su sha256).
      if (error && !/exists|duplicate/i.test(error.message)) throw new Error(`No se pudo guardar el comprobante: ${error.message}`);
    },
    async get(name) {
      const { data, error } = await bucket().download(safeName(name));
      if (error || !data) throw new Error(`No se pudo leer el comprobante: ${error?.message ?? "sin datos"}`);
      return Buffer.from(await data.arrayBuffer());
    },
  };
}
