// Sirve la imagen de un comprobante. El organizador ve todos; el colaborador, solo los suyos. Los archivos viven en Supabase Storage
// (bucket privado) o, en desarrollo, en data/receipts.
import { getSession } from "@/lib/session.ts";
import * as server from "@/lib/server.ts";
import { requestFor } from "@/lib/workflow.ts";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return new Response("No autorizado", { status: 401 });
  const id = Number.parseInt((await params).id, 10);
  if (!Number.isSafeInteger(id) || id <= 0) return new Response("No encontrado", { status: 404 });
  // Lo ajeno responde 404, igual que lo inexistente.
  const r = await requestFor(await server.ctx(), session, id);
  if (!r) return new Response("No encontrado", { status: 404 });
  let bytes: Buffer;
  try {
    bytes = await server.receipts().get(r.file_path);
  } catch {
    return new Response("No encontrado", { status: 404 });
  }
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": r.mime,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'",
    },
  });
}
