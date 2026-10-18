// Reconciliación de pagos: resuelve pagos signed/sent/uncertain mirando la cadena.
// Nunca firma una transacción nueva: como máximo re-difunde el MISMO raw_tx (mismo hash, mismo nonce).
import { getAddress, keccak256, type Address, type Hex } from "viem";
import type { DB, Queryable } from "../db.ts";
import { tx } from "../db.ts";
import * as repo from "../repo.ts";
import type { PaymentRow } from "../types.ts";
import type { ChainClient, ChainReceipt } from "./clients.ts";
import { verifyPayment } from "./verify.ts";

/** Un pago 'preparing' más viejo que esto, sin raw_tx, se considera abandonado (nunca se firmó). */
export const STALE_PREPARING_MS = 2 * 60 * 1000;

export interface ReconcileResult {
  paymentId: number;
  status: PaymentRow["status"];
  note: string;
}

async function failPayment(q: Queryable, p: PaymentRow, reason: string): Promise<void> {
  await repo.updatePayment(q, p.id, { status: "failed", error: reason });
  await repo.revokeAuthorization(q, p.authorization_id, `Pago fallido: ${reason}`);
  await repo.setStatus(q, p.request_id, "payment_failed");
  await repo.audit(q, p.request_id, "sistema", "payment_failed", { payment_id: p.id, reason });
}

/**
 * Aplica el resultado de verify a un pago con receipt. Usado por payTool y por reconcile.
 * Solo pasa a 'confirmed' si el receipt es success y el Transfer coincide exactamente.
 */
export function applyReceipt(db: DB, paymentId: number, receipt: ChainReceipt, txInput: Hex | null): Promise<PaymentRow["status"]> {
  return tx(db, async (q) => {
    const p = (await repo.getPayment(q, paymentId))!;
    if (p.status === "confirmed" || p.status === "failed") return p.status;
    const auth = (await repo.getAuthorization(q, p.authorization_id))!;
    const v = verifyPayment(receipt, txInput, {
      token: getAddress(auth.token_address),
      from: getAddress(p.from_address as Address),
      to: getAddress(auth.recipient),
      value: BigInt(auth.token_amount),
    });
    const block = Number(v.blockNumber);
    if (v.outcome === "confirmed") {
      await repo.updatePayment(q, p.id, { status: "confirmed", block_number: block, attribution_ok: v.attributionOk ? 1 : 0, error: null });
      await repo.setStatus(q, p.request_id, "reimbursed");
      await repo.audit(q, p.request_id, "sistema", "payment_confirmed", {
        payment_id: p.id,
        tx_hash: p.tx_hash,
        block_number: block,
        attribution_ok: v.attributionOk,
      });
      return "confirmed";
    }
    if (v.outcome === "reverted") {
      await repo.updatePayment(q, p.id, { block_number: block });
      await failPayment(q, { ...p, block_number: block }, v.reason);
      return "failed";
    }
    // Minada con éxito pero el Transfer no coincide: no se confirma ni se marca fallida (podrían haberse movido fondos).
    await repo.updatePayment(q, p.id, {
      status: "uncertain",
      block_number: block,
      attribution_ok: v.attributionOk ? 1 : 0,
      error: `${v.reason} Revisar manualmente en Celoscan.`,
    });
    await repo.setStatus(q, p.request_id, "payment_uncertain");
    await repo.audit(q, p.request_id, "sistema", "payment_mismatch", { payment_id: p.id, reason: v.reason });
    return "uncertain";
  });
}

export async function reconcile(db: DB, chain: ChainClient | null, paymentId: number, nowMs = Date.now()): Promise<ReconcileResult> {
  const p = await repo.getPayment(db, paymentId);
  if (!p) throw new Error(`No existe el pago #${paymentId}`);
  const done = (status: PaymentRow["status"], note: string): ReconcileResult => ({ paymentId, status, note });

  if (p.status === "confirmed" || p.status === "failed") return done(p.status, "El pago ya está resuelto.");

  if (p.status === "preparing") {
    // Sin raw_tx no se firmó ni se difundió nada: si quedó colgado (reinicio), es seguro marcarlo fallido.
    if (!p.raw_tx && nowMs - Date.parse(p.updated_at) > STALE_PREPARING_MS) {
      await tx(db, (q) => failPayment(q, p, "El pago quedó a medio preparar (nunca se firmó ni se difundió)."));
      return done("failed", "Pago abandonado antes de firmar.");
    }
    return done("preparing", "El pago se está preparando.");
  }

  if (p.mode === "simulated" || !chain) return done(p.status, "Sin cliente de cadena para reconciliar.");
  if (!p.tx_hash || !p.raw_tx || p.nonce == null || !p.from_address) {
    return done(p.status, "Faltan datos del pago firmado; revisar manualmente.");
  }
  const hash = p.tx_hash as Hex;

  let receipt: ChainReceipt | null;
  try {
    receipt = await chain.getReceipt(hash);
  } catch (err) {
    return done(p.status, `No se pudo consultar la red: ${(err as Error).message.slice(0, 200)}`);
  }
  if (receipt) {
    const txInfo = await chain.getTransaction(hash).catch(() => null);
    const status = await applyReceipt(db, p.id, receipt, txInfo?.input ?? null);
    return done(status, "Se encontró el receipt en la cadena.");
  }

  try {
    const pending = await chain.getTransaction(hash);
    if (pending) {
      await tx(db, async (q) => {
        await repo.updatePayment(q, p.id, { status: "sent", error: null });
        await repo.setStatus(q, p.request_id, "paying");
      });
      return done("sent", "La transacción está en la red, pendiente de minarse.");
    }
    const latest = await chain.getTransactionCount(getAddress(p.from_address), "latest");
    if (latest > p.nonce) {
      // El nonce pudo consumirlo NUESTRA transacción y el nodo que respondió getReceipt estar atrasado.
      // Antes de declararla fallida (lo que habilita re-autorizar y pagar de nuevo), volver a buscarla.
      const late = await chain.getReceipt(hash);
      if (late) {
        const txInfo = await chain.getTransaction(hash).catch(() => null);
        const status = await applyReceipt(db, p.id, late, txInfo?.input ?? null);
        return done(status, "Se encontró el receipt en la cadena (segunda consulta).");
      }
      await tx(db, (q) =>
        failPayment(
          q,
          p,
          `El nonce ${p.nonce} ya lo usó otra transacción de la wallet del agente; esta transacción nunca se va a minar.`,
        ),
      );
      return done("failed", "Nonce consumido por otra transacción.");
    }
  } catch (err) {
    return done(p.status, `No se pudo consultar la red: ${(err as Error).message.slice(0, 200)}`);
  }

  // Ni receipt ni transacción, y el nonce sigue libre: re-difundir el MISMO raw_tx.
  try {
    const sentHash = await chain.sendRawTransaction(p.raw_tx as Hex);
    if (sentHash.toLowerCase() !== hash.toLowerCase() || keccak256(p.raw_tx as Hex) !== hash) {
      throw new Error("El hash re-difundido no coincide con el guardado.");
    }
    await tx(db, async (q) => {
      await repo.updatePayment(q, p.id, { status: "sent", error: null });
      await repo.setStatus(q, p.request_id, "paying");
      await repo.audit(q, p.request_id, "sistema", "payment_rebroadcast", { payment_id: p.id, tx_hash: hash });
    });
    return done("sent", "Se re-difundió la misma transacción firmada (mismo hash y nonce).");
  } catch (err) {
    const msg = (err as Error).message.slice(0, 300);
    await tx(db, async (q) => {
      await repo.updatePayment(q, p.id, { status: "uncertain", error: msg });
      await repo.setStatus(q, p.request_id, "payment_uncertain");
    });
    return done("uncertain", `No se pudo re-difundir: ${msg}`);
  }
}
