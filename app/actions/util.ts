// Utilidades compartidas por las server actions (este archivo no es "use server").
import { WorkflowError } from "@/lib/workflow.ts";
import { AuthError } from "@/lib/auth.ts";
import { PaymentError } from "@/lib/chain/payTool.ts";
import { MoneyParseError } from "@/lib/money.ts";
import { SignerError } from "@/lib/chain/signer.ts";

export function errorMessage(err: unknown): string {
  if (err instanceof WorkflowError || err instanceof AuthError || err instanceof PaymentError || err instanceof MoneyParseError || err instanceof SignerError) {
    return err.message;
  }
  // Solo el mensaje, nunca el objeto completo (podría arrastrar headers o config).
  console.error("[respend] error inesperado:", err instanceof Error ? err.message : String(err));
  return "Ocurrió un error inesperado. Probá de nuevo.";
}

export function withQuery(path: string, key: "error" | "ok", msg: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(msg)}`;
}

export function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

export function idFrom(fd: FormData): number {
  const n = Number.parseInt(str(fd, "requestId"), 10);
  if (!Number.isSafeInteger(n) || n <= 0) throw new WorkflowError("Solicitud inválida.");
  return n;
}
