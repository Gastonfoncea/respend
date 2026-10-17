"use server";
// Acciones sobre solicitudes. Cada una lee la sesión; el rol lo verifica lib/workflow.ts o payAsOrganizer.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session.ts";
import * as server from "@/lib/server.ts";
import * as wf from "@/lib/workflow.ts";
import { assertRole } from "@/lib/auth.ts";
import { payAsOrganizer } from "@/lib/chain/payTool.ts";
import { after } from "next/server";
import { runAutoPay } from "@/lib/autopay.ts";
import { reconcile } from "@/lib/chain/reconcile.ts";
import * as repo from "@/lib/repo.ts";
import { parseArsToCents } from "@/lib/money.ts";
import { errorMessage, idFrom, str, withQuery } from "./util.ts";

const reqPath = (id: number) => `/solicitudes/${id}`;

export async function submitExpenseAction(fd: FormData) {
  let target: string;
  try {
    const session = await getSession();
    const file = fd.get("receipt");
    if (!(file instanceof File) || file.size === 0) throw new wf.WorkflowError("Falta la imagen del comprobante.");
    const ctx = server.ctx();
    // El destinatario sale siempre del perfil del colaborador, nunca del formulario.
    const profile = repo.getCollaboratorProfile(ctx.db);
    if (!profile?.wallet || !profile.name) throw new wf.WorkflowError("Primero completá tu perfil (nombre y wallet de cobro) en \"Mi perfil\".");
    const recipient = profile.wallet;
    const id = wf.submitExpense(ctx, session, {
      description: str(fd, "description"),
      recipient,
      file: { bytes: new Uint8Array(await file.arrayBuffer()), mime: file.type },
    });
    await wf.analyzeRequest(ctx, id);
    target = startAutoPay(ctx, id, reqPath(id));
  } catch (err) {
    target = withQuery("/presentar", "error", errorMessage(err));
  }
  revalidatePath("/evento");
  redirect(target);
}

export async function retryAnalysisAction(fd: FormData) {
  let target: string;
  try {
    assertRole(await getSession(), ["organizer", "collaborator"]);
    const id = idFrom(fd);
    target = reqPath(id);
    const ctx = server.ctx();
    const r = await wf.analyzeRequest(ctx, id);
    if (r.ai_error) target = withQuery(target, "error", r.ai_error);
    else target = startAutoPay(ctx, id, target);
  } catch (err) {
    target = withQuery(`/solicitudes/${str(fd, "requestId")}`, "error", errorMessage(err));
  }
  redirect(target);
}

export async function respondAction(fd: FormData) {
  let target = `/solicitudes/${str(fd, "requestId")}`;
  try {
    const id = idFrom(fd);
    const ctx = server.ctx();
    wf.respondClarification(ctx, await getSession(), id, str(fd, "message"));
    const r = await wf.analyzeRequest(ctx, id);
    if (r.ai_error) target = withQuery(target, "error", r.ai_error);
    else target = startAutoPay(ctx, id, target);
  } catch (err) {
    target = withQuery(target, "error", errorMessage(err));
  }
  revalidatePath("/evento");
  redirect(target);
}

export async function requestClarificationAction(fd: FormData) {
  let target = `/solicitudes/${str(fd, "requestId")}`;
  try {
    wf.requestClarification(server.ctx(), await getSession(), idFrom(fd), str(fd, "message"));
    target = withQuery(target, "ok", "Se pidió la aclaración al colaborador.");
  } catch (err) {
    target = withQuery(target, "error", errorMessage(err));
  }
  redirect(target);
}

export async function correctAction(fd: FormData) {
  let target = `/solicitudes/${str(fd, "requestId")}`;
  try {
    wf.correctFields(server.ctx(), await getSession(), idFrom(fd), {
      date: str(fd, "date") || null,
      merchant: str(fd, "merchant") || null,
      concept: str(fd, "concept") || null,
      amount: str(fd, "amount") || null,
      currency: str(fd, "currency") || null,
      category: str(fd, "category") || null,
    });
    target = withQuery(target, "ok", "Datos corregidos. Se recalcularon los checks.");
  } catch (err) {
    target = withQuery(target, "error", errorMessage(err));
  }
  redirect(target);
}

export async function rejectAction(fd: FormData) {
  let target = `/solicitudes/${str(fd, "requestId")}`;
  try {
    wf.rejectRequest(server.ctx(), await getSession(), idFrom(fd), str(fd, "reason"));
    target = withQuery(target, "ok", "Solicitud rechazada.");
  } catch (err) {
    target = withQuery(target, "error", errorMessage(err));
  }
  revalidatePath("/evento");
  redirect(target);
}

/** "Autorizar y pagar": crea la autorización humana y en la misma acción invoca la herramienta de pago. */
export async function authorizeAndPayAction(fd: FormData) {
  let target = `/solicitudes/${str(fd, "requestId")}`;
  try {
    const session = await getSession();
    const id = idFrom(fd);
    const ctx = server.ctx();
    wf.authorize(ctx, session, id, {
      verifiedAmountAndRecipient: fd.get("verified") === "on",
      reviewedAlerts: fd.get("reviewedAlerts") === "on",
      reason: str(fd, "reason"),
    });
    const res = await payAsOrganizer(session, id, server.payTool(), ctx.db);
    target = withQuery(target, res.status === "confirmed" ? "ok" : "error", payMessage(res.status, res.mode));
  } catch (err) {
    target = withQuery(target, "error", errorMessage(err));
  }
  revalidatePath("/evento");
  redirect(target);
}

/** Reintentar el pago de una solicitud ya autorizada (por ejemplo, si falló una verificación previa a firmar). */
export async function payAction(fd: FormData) {
  let target = `/solicitudes/${str(fd, "requestId")}`;
  try {
    const id = idFrom(fd);
    const res = await payAsOrganizer(await getSession(), id, server.payTool(), server.db());
    target = withQuery(target, res.status === "confirmed" ? "ok" : "error", payMessage(res.status, res.mode));
  } catch (err) {
    target = withQuery(target, "error", errorMessage(err));
  }
  revalidatePath("/evento");
  redirect(target);
}

export async function reconcileAction(fd: FormData) {
  let target = `/solicitudes/${str(fd, "requestId")}`;
  try {
    assertRole(await getSession(), ["organizer"]);
    const id = idFrom(fd);
    const p = repo.latestPayment(server.db(), id);
    if (!p) throw new wf.WorkflowError("No hay pagos para reconciliar.");
    const r = await reconcile(server.db(), p.mode === "mainnet" ? server.chain() : null, p.id);
    target = withQuery(target, "ok", r.note);
  } catch (err) {
    target = withQuery(target, "error", errorMessage(err));
  }
  revalidatePath("/evento");
  redirect(target);
}

/**
 * Si el gasto entra en el pago automático, el agente lo autoriza ya (decide el código) y el pago corre
 * en segundo plano, después de responder: la página del gasto muestra "El agente está pagando…" y se
 * refresca sola hasta que se confirma.
 */
function startAutoPay(ctx: ReturnType<typeof server.ctx>, id: number, target: string): string {
  if (wf.autoAuthorize(ctx, id) == null) return target;
  const payTool = server.payTool();
  after(() => runAutoPay(ctx, id, payTool));
  return target;
}

function payMessage(status: string, mode: string): string {
  if (status === "confirmed") return mode === "simulated" ? "Pago SIMULADO registrado (no hubo transacción en Celo)." : "Pago confirmado en Celo.";
  if (status === "uncertain") return "El pago quedó en estado incierto: no se reintenta solo. Usá \"Reconciliar\".";
  if (status === "failed") return "El pago falló. Hace falta una nueva autorización.";
  return `Estado del pago: ${status}.`;
}

export async function updatePolicyAction(fd: FormData) {
  let target = "/evento/politica";
  try {
    const categories = str(fd, "categories")
      .split(",")
      .map((c) => c.trim().toLowerCase())
      .filter(Boolean);
    wf.updatePolicy(server.ctx(), await getSession(), {
      name: str(fd, "name"),
      startDate: str(fd, "startDate"),
      endDate: str(fd, "endDate"),
      categories,
      capPerReceiptCents: parseArsToCents(str(fd, "cap")),
      budgetCents: parseArsToCents(str(fd, "budget")),
    });
    target = withQuery(target, "ok", "Política actualizada.");
  } catch (err) {
    target = withQuery(target, "error", errorMessage(err));
  }
  revalidatePath("/evento");
  redirect(target);
}

export async function setMyProfileAction(fd: FormData) {
  let target: string;
  try {
    wf.setCollaboratorProfile(server.ctx(), await getSession(), { name: str(fd, "name"), wallet: str(fd, "wallet") });
    target = withQuery("/wallet", "ok", "Perfil guardado. Los próximos gastos salen con este nombre y se pagan a esta wallet.");
  } catch (err) {
    target = withQuery("/wallet", "error", errorMessage(err));
  }
  revalidatePath("/wallet");
  revalidatePath("/presentar");
  redirect(target);
}

export async function setAutoPayLimitAction(fd: FormData) {
  let target = "/agente";
  try {
    const session = await getSession();
    const ctx = server.ctx();
    const raw = str(fd, "limit").trim();
    wf.setAutoPayLimit(ctx, session, raw === "" ? 0 : parseArsToCents(raw));
    // Tope de 24 h: vacío = automático (3 veces el límite por gasto).
    if (fd.has("dailyCap")) {
      const cap = str(fd, "dailyCap").trim();
      wf.setAutoPayDailyCap(ctx, session, cap === "" ? null : parseArsToCents(cap));
    }
    target = withQuery(target, "ok", "Pago automático guardado.");
  } catch (err) {
    target = withQuery(target, "error", errorMessage(err));
  }
  revalidatePath("/agente");
  redirect(target);
}

/** Vista previa del agente: lee el ticket antes de enviar. No guarda nada. */
export async function previewExpenseAction(_prev: wf.PreviewResult | null, fd: FormData): Promise<wf.PreviewResult> {
  try {
    const file = fd.get("receipt");
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Falta la imagen del comprobante." };
    return await wf.previewExpense(server.ctx(), await getSession(), { bytes: new Uint8Array(await file.arrayBuffer()) });
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
