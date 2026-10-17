// Pago automático: después de un análisis, si la solicitud entra en el límite que fijó el organizador
// y no tiene ninguna alerta, el agente la autoriza y la paga sin esperar al organizador.
// Usa la misma herramienta de pago de siempre (recibe solo requestId). Si algo falla, la solicitud
// queda donde la herramienta la deje (authorized / payment_failed / payment_uncertain) para el organizador.
import * as repo from "./repo.ts";
import { autoAuthorize, type Ctx } from "./workflow.ts";
import type { PayResult, PayTool } from "./chain/payTool.ts";

export async function maybeAutoPay(ctx: Ctx, requestId: number, payTool: PayTool): Promise<PayResult | null> {
  if (autoAuthorize(ctx, requestId) == null) return null;
  try {
    return await payTool(requestId);
  } catch (err) {
    // Falló antes de reservar el pago (por ejemplo, falta la clave o hay otro pago en curso):
    // la autorización sigue vigente y el organizador puede reintentar con "Pagar".
    repo.audit(ctx.db, requestId, "sistema", "auto_pay_error", { error: (err as Error).message.slice(0, 300) });
    return null;
  }
}
