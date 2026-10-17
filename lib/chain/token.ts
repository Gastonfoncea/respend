// wARS es un ERC-20 estándar. Usamos decimals, symbol, balanceOf, transfer y el evento Transfer.
import { encodeFunctionData, erc20Abi, parseEventLogs, getAddress, type Address, type Hex } from "viem";
import type { ChainLog } from "./clients.ts";

export const ERC20_ABI = erc20Abi;

export function encodeTransfer(to: Address, amount: bigint): Hex {
  return encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] });
}

export interface TransferLog {
  token: Address;
  from: Address;
  to: Address;
  value: bigint;
}

/** Logs Transfer emitidos por `token` (ignora los de otros contratos). */
export function transferLogsOf(logs: ChainLog[], token: Address): TransferLog[] {
  const own = logs.filter((l) => getAddress(l.address) === getAddress(token));
  return parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: own as never[], strict: true }).map((l) => ({
    token: getAddress(l.address),
    from: getAddress(l.args.from),
    to: getAddress(l.args.to),
    value: l.args.value,
  }));
}
