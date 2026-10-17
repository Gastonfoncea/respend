// Sirve la imagen de un comprobante. Requiere sesión (cualquier rol). Los archivos viven en data/receipts.
import fs from "node:fs";
import path from "node:path";
import { getSession } from "@/lib/session.ts";
import * as server from "@/lib/server.ts";
import * as repo from "@/lib/repo.ts";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getSession())) return new Response("No autorizado", { status: 401 });
  const id = Number.parseInt((await params).id, 10);
  if (!Number.isSafeInteger(id) || id <= 0) return new Response("No encontrado", { status: 404 });
  const r = repo.getRequest(server.db(), id);
  if (!r) return new Response("No encontrado", { status: 404 });
  const full = path.join(server.config().receiptsDir, path.basename(r.file_path));
  if (!fs.existsSync(full)) return new Response("No encontrado", { status: 404 });
  return new Response(new Uint8Array(fs.readFileSync(full)), {
    headers: {
      "content-type": r.mime,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'",
    },
  });
}
