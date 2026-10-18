// Pago automático: después de un análisis, si la solicitud entra en el límite que fijó el organizador
// y no tiene ninguna alerta, el agente la autoriza y la paga sin esperar al organizador.
// Usa la misma herramienta de pago de siempre (recibe solo requestId). Si algo falla, la solicitud
// queda donde la herramienta la deje (authorized / payment_failed / payment_uncertain) para el organizador.
import * as repo from "./repo.ts";
import { autoAuthorize, type Ctx } from "./workflow.ts";
import type { PayResult, PayTool } from "./chain/payTool.ts";
import type { AuthorizationRow } from "./types.ts";

/** Ejecuta el pago de una solicitud que el agente ya autorizó solo. Pensado para correr en segundo plano. */
export async function runAutoPay(ctx: Ctx, requestId: number, payTool: PayTool): Promise<PayResult | null> {
  try {
    return await payTool(requestId);
  } catch (err) {
    // Falló antes de reservar el pago (por ejemplo, falta la clave o hay otro pago en curso):
    // la autorización sigue vigente y el organizador puede reintentar con "Pagar".
    await repo.audit(ctx.db, requestId, "sistema", "auto_pay_error", { error: (err as Error).message.slice(0, 300) });
    return null;
  }
}

/** Decide y paga en el mismo paso (tests y scripts). La app decide y paga en segundo plano por separado. */
export async function maybeAutoPay(ctx: Ctx, requestId: number, payTool: PayTool): Promise<PayResult | null> {
  if ((await autoAuthorize(ctx, requestId)) == null) return null;
  return runAutoPay(ctx, requestId, payTool);
}

/** La autorización vigente de la solicitud, si la dio el agente solo. */
export function autoAuthorizationOf(auths: AuthorizationRow[]): AuthorizationRow | null {
  return auths.find((a) => a.revoked_at == null && a.authorized_by.startsWith(repo.AUTO_PAY_ACTOR)) ?? null;
}
