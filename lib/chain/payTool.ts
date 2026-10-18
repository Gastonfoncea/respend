// Herramienta de pago controlada. ÚNICA interfaz de pago: recibe solo requestId.
// Monto, destinatario, token y red se leen de la autorización humana guardada; nada viene del LLM.
import { getAddress, keccak256, toHex, type Address, type Hex } from "viem";
import type { LocalAccount } from "viem/accounts";
import type { DB } from "../db.ts";
import { tx } from "../db.ts";
import * as repo from "../repo.ts";
import { assertRole, actorName } from "../auth.ts";
import { getBudget } from "../budget.ts";
import { bindingFor, bindingHash } from "../binding.ts";
import { CHAIN_ID, WARS_ADDRESS, WARS_DECIMALS, WARS_SYMBOL, type PaymentMode } from "../config.ts";
import type { PaymentRow, Session } from "../types.ts";
import type { ChainClient } from "./clients.ts";
import { encodeTransfer } from "./token.ts";
import { withAttribution } from "./attribution.ts";
import { applyReceipt } from "./reconcile.ts";

export class PaymentError extends Error {}
export class MainnetGuardError extends PaymentError {}

export interface PayDeps {
  db: DB;
  mode: PaymentMode;
  /** Obligatorio en mainnet. */
  chain?: ChainClient | null;
  /** Wallet del agente (lib/chain/signer.ts). Obligatoria en mainnet. */
  account?: LocalAccount | null;
  receiptTimeoutMs?: number;
}

export interface PayResult {
  paymentId: number;
  mode: PaymentMode;
  status: PaymentRow["status"];
  txHash: string | null;
}

export type PayTool = (requestId: number) => Promise<PayResult>;

/** Verificaciones onchain antes de firmar: red y token tienen que ser exactamente los esperados. */
export async function assertMainnetTarget(chain: ChainClient): Promise<void> {
  const chainId = await chain.getChainId();
  if (chainId !== CHAIN_ID) throw new MainnetGuardError(`La red responde chainId ${chainId}, se esperaba ${CHAIN_ID} (Celo).`);
  const meta = await chain.readTokenMeta(WARS_ADDRESS);
  if (meta.decimals !== WARS_DECIMALS) throw new MainnetGuardError(`El token tiene ${meta.decimals} decimales, se esperaban ${WARS_DECIMALS}.`);
  if (meta.symbol !== WARS_SYMBOL) throw new MainnetGuardError(`El token se llama "${meta.symbol}", se esperaba "${WARS_SYMBOL}".`);
}

export function createPayTool(deps: PayDeps): PayTool {
  return async function executeAuthorizedReimbursement(requestId: number): Promise<PayResult> {
    const { db, mode } = deps;
    let from: Address | null = deps.account?.address ?? null;

    if (mode === "mainnet") {
      if (!deps.account) throw new PaymentError("Falta AGENT_PRIVATE_KEY: no hay wallet del agente para pagar en mainnet.");
      if (!deps.chain) throw new PaymentError("Falta el cliente de Celo.");
      await assertMainnetTarget(deps.chain);
      from = getAddress(deps.account.address);
    }

    // 1. Reserva atómica del pago.
    // Corre bajo el lock global de escritura: el chequeo de "pago en curso" y el INSERT no se intercalan
    // con otra instancia. El índice único one_payment_in_flight es la segunda barrera.
    const reserved = await tx(db, async (q) => {
      const r = await repo.getRequest(q, requestId);
      if (!r) throw new PaymentError(`No existe la solicitud #${requestId}.`);
      if (r.status !== "authorized") throw new PaymentError(`La solicitud está en estado "${r.status}": no se puede pagar.`);
      const auth = await repo.getActiveAuthorization(q, requestId);
      if (!auth) throw new PaymentError("No hay una autorización vigente.");
      const policy = await repo.getPolicy(q);
      const current = bindingHash(bindingFor(r, policy.version));
      if (current !== auth.binding_hash || auth.chain_id !== CHAIN_ID || getAddress(auth.token_address) !== WARS_ADDRESS) {
        await repo.revokeAuthorization(q, auth.id, "Los datos cambiaron después de autorizar.");
        await repo.setStatus(q, requestId, "analyzed");
        await repo.audit(q, requestId, "sistema", "authorization_revoked", { authorization_id: auth.id, reason: "binding_mismatch" });
        return { revoked: true as const };
      }
      const live = await repo.listLivePayments(q);
      if (live.length) throw new PaymentError(`Hay otro pago en curso (#${live[0].id}); reconcilialo primero.`);
      const budget = await getBudget(q);
      if (budget.committedCents > budget.totalCents) throw new PaymentError("El pago superaría el presupuesto del evento.");

      const paymentId = await repo.insertPayment(q, { requestId, authorizationId: auth.id, mode, fromAddress: from });
      await repo.setStatus(q, requestId, "paying");
      await repo.audit(q, requestId, "agente", "payment_started", { payment_id: paymentId, authorization_id: auth.id, mode });
      return { revoked: false as const, paymentId, auth };
    });
    if (reserved.revoked) throw new PaymentError("Los datos cambiaron después de autorizar: la autorización se revocó y hace falta una nueva.");
    const { paymentId, auth } = reserved;

    // 2. Simulado: no hay transacción en Celo.
    if (mode === "simulated") {
      const fakeHash = keccak256(toHex(JSON.stringify({ requestId, authorizationId: auth.id, at: new Date().toISOString() })));
      await tx(db, async (q) => {
        await repo.updatePayment(q, paymentId, { status: "confirmed", tx_hash: fakeHash });
        await repo.setStatus(q, requestId, "reimbursed");
        await repo.audit(q, requestId, "agente", "payment_confirmed", { payment_id: paymentId, mode: "simulated", tx_hash: fakeHash });
      });
      return { paymentId, mode, status: "confirmed", txHash: fakeHash };
    }

    // 3. Mainnet.
    const chain = deps.chain!;
    const account = deps.account!;
    const to = getAddress(auth.recipient);
    const data = withAttribution(encodeTransfer(to, BigInt(auth.token_amount)));

    let raw: Hex;
    let nonce: number;
    try {
      const prep = await chain.prepareTransaction({ from: from!, to: WARS_ADDRESS, data });
      nonce = prep.nonce;
      raw = await account.signTransaction({
        type: "eip1559",
        chainId: CHAIN_ID,
        to: WARS_ADDRESS,
        data,
        value: 0n,
        nonce: prep.nonce,
        gas: prep.gas,
        maxFeePerGas: prep.maxFeePerGas,
        maxPriorityFeePerGas: prep.maxPriorityFeePerGas,
      });
    } catch (err) {
      // Nada se firmó ni se difundió: es seguro marcarlo como fallido.
      const reason = `No se pudo preparar la transacción: ${(err as Error).message.slice(0, 200)}`;
      await tx(db, async (q) => {
        await repo.updatePayment(q, paymentId, { status: "failed", error: reason });
        await repo.revokeAuthorization(q, auth.id, reason);
        await repo.setStatus(q, requestId, "payment_failed");
        await repo.audit(q, requestId, "sistema", "payment_failed", { payment_id: paymentId, reason });
      });
      return { paymentId, mode, status: "failed", txHash: null };
    }
    const txHash = keccak256(raw);

    // Persistir ANTES de difundir: si el proceso muere, reconcile puede re-difundir exactamente esto.
    await tx(db, async (q) => {
      await repo.updatePayment(q, paymentId, { status: "signed", nonce, raw_tx: raw, tx_hash: txHash });
      await repo.audit(q, requestId, "agente", "payment_signed", { payment_id: paymentId, tx_hash: txHash, nonce });
    });

    try {
      await chain.sendRawTransaction(raw);
      await tx(db, (q) => repo.updatePayment(q, paymentId, { status: "sent" }));
    } catch (err) {
      // Nunca asumir que "no salió": puede haber llegado al nodo igual.
      const msg = (err as Error).message.slice(0, 300);
      await tx(db, async (q) => {
        await repo.updatePayment(q, paymentId, { status: "uncertain", error: `Error al difundir: ${msg}` });
        await repo.setStatus(q, requestId, "payment_uncertain");
        await repo.audit(q, requestId, "sistema", "payment_uncertain", { payment_id: paymentId, error: msg });
      });
      return { paymentId, mode, status: "uncertain", txHash };
    }

    const receipt = await chain.waitForReceipt(txHash, deps.receiptTimeoutMs ?? 60_000).catch(() => null);
    if (!receipt) {
      await tx(db, async (q) => {
        await repo.updatePayment(q, paymentId, { status: "uncertain", error: "No llegó el receipt a tiempo; reconciliar." });
        await repo.setStatus(q, requestId, "payment_uncertain");
      });
      return { paymentId, mode, status: "uncertain", txHash };
    }
    const txInfo = await chain.getTransaction(txHash).catch(() => null);
    const status = await applyReceipt(db, paymentId, receipt, txInfo?.input ?? data);
    return { paymentId, mode, status, txHash };
  };
}

/** Lo que llama la server action: verifica que quien dispara el pago sea el organizador. */
export async function payAsOrganizer(session: Session | null, requestId: number, payTool: PayTool, db: DB): Promise<PayResult> {
  const s = assertRole(session, ["organizer"]);
  await repo.audit(db, requestId, actorName(s), "payment_requested", null);
  return payTool(requestId);
}
