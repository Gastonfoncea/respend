// Verificación de un pago onchain: receipt exitoso + exactamente un Transfer correcto + tag ERC-8021.
import { getAddress, type Address, type Hex } from "viem";
import type { ChainReceipt } from "./clients.ts";
import { transferLogsOf } from "./token.ts";
import { hasOurAttribution } from "./attribution.ts";

export interface ExpectedTransfer {
  token: Address;
  from: Address;
  to: Address;
  value: bigint;
}

export type VerifyResult =
  | { outcome: "confirmed"; attributionOk: boolean; blockNumber: bigint }
  | { outcome: "reverted"; reason: string; blockNumber: bigint }
  | { outcome: "mismatch"; reason: string; attributionOk: boolean; blockNumber: bigint };

export function verifyPayment(receipt: ChainReceipt, txInput: Hex | null, expected: ExpectedTransfer): VerifyResult {
  const attributionOk = hasOurAttribution(txInput);
  if (receipt.status !== "success") {
    return { outcome: "reverted", reason: "La transacción se minó pero revirtió (no se movieron fondos).", blockNumber: receipt.blockNumber };
  }
  const transfers = transferLogsOf(receipt.logs, expected.token);
  if (transfers.length !== 1) {
    return {
      outcome: "mismatch",
      reason: `Se esperaba exactamente un Transfer de wARS y hubo ${transfers.length}.`,
      attributionOk,
      blockNumber: receipt.blockNumber,
    };
  }
  const t = transfers[0];
  const problems: string[] = [];
  if (t.from !== getAddress(expected.from)) problems.push(`origen ${t.from}`);
  if (t.to !== getAddress(expected.to)) problems.push(`destino ${t.to}`);
  if (t.value !== expected.value) problems.push(`monto ${t.value}`);
  if (problems.length) {
    return {
      outcome: "mismatch",
      reason: `El Transfer no coincide con lo autorizado: ${problems.join(", ")}.`,
      attributionOk,
      blockNumber: receipt.blockNumber,
    };
  }
  return { outcome: "confirmed", attributionOk, blockNumber: receipt.blockNumber };
}
