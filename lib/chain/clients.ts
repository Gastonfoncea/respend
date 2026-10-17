// Cliente de cadena: interfaz mínima que usan payTool/reconcile, con implementación real (forno) y
// una cadena falsa en memoria para los tests (lib/chain/fakeChain.ts).
import {
  createPublicClient,
  http,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  WaitForTransactionReceiptTimeoutError,
  type Address,
  type Hex,
} from "viem";
import { celo } from "viem/chains";
import { RPC_URL } from "../config.ts";
import { ERC20_ABI } from "./token.ts";

export interface ChainLog {
  address: Address;
  topics: Hex[];
  data: Hex;
}

export interface ChainReceipt {
  transactionHash: Hex;
  status: "success" | "reverted";
  blockNumber: bigint;
  from: Address;
  logs: ChainLog[];
}

export interface ChainTx {
  hash: Hex;
  input: Hex;
  nonce: number;
  from: Address;
}

export interface PreparedFees {
  nonce: number;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

export interface ChainClient {
  getChainId(): Promise<number>;
  readTokenMeta(token: Address): Promise<{ decimals: number; symbol: string; name: string }>;
  getTokenBalance(token: Address, owner: Address): Promise<bigint>;
  getNativeBalance(owner: Address): Promise<bigint>;
  /** Nonce "pending", gas estimado y fees EIP-1559 (pagadas en CELO). */
  prepareTransaction(req: { from: Address; to: Address; data: Hex }): Promise<PreparedFees>;
  sendRawTransaction(raw: Hex): Promise<Hex>;
  /** null si vence el timeout. */
  waitForReceipt(hash: Hex, timeoutMs: number): Promise<ChainReceipt | null>;
  /** null si no existe. Errores de red se propagan. */
  getReceipt(hash: Hex): Promise<ChainReceipt | null>;
  getTransaction(hash: Hex): Promise<ChainTx | null>;
  getTransactionCount(addr: Address, blockTag: "latest" | "pending"): Promise<number>;
}

export function createPublicCeloClient() {
  return createPublicClient({ chain: celo, transport: http(RPC_URL, { timeout: 20_000, retryCount: 1 }) });
}

type ViemReceipt = Awaited<ReturnType<ReturnType<typeof createPublicCeloClient>["getTransactionReceipt"]>>;

function toReceipt(r: ViemReceipt): ChainReceipt {
  return {
    transactionHash: r.transactionHash,
    status: r.status,
    blockNumber: r.blockNumber,
    from: r.from,
    logs: r.logs.map((l) => ({ address: l.address, topics: l.topics as Hex[], data: l.data })),
  };
}

/** Cliente real contra https://forno.celo.org. Solo lectura, salvo sendRawTransaction (lo usan payTool/reconcile). */
export function createRealChain(): ChainClient {
  const client = createPublicCeloClient();
  return {
    getChainId: () => client.getChainId(),
    async readTokenMeta(token) {
      const [decimals, symbol, name] = await Promise.all([
        client.readContract({ address: token, abi: ERC20_ABI, functionName: "decimals" }),
        client.readContract({ address: token, abi: ERC20_ABI, functionName: "symbol" }),
        client.readContract({ address: token, abi: ERC20_ABI, functionName: "name" }),
      ]);
      return { decimals: Number(decimals), symbol, name };
    },
    getTokenBalance: (token, owner) =>
      client.readContract({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [owner] }),
    getNativeBalance: (owner) => client.getBalance({ address: owner }),
    async prepareTransaction({ from, to, data }) {
      const [nonce, gas, fees] = await Promise.all([
        client.getTransactionCount({ address: from, blockTag: "pending" }),
        client.estimateGas({ account: from, to, data }),
        client.estimateFeesPerGas(),
      ]);
      return {
        nonce,
        // 20 % de margen sobre la estimación.
        gas: (gas * 12n) / 10n,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      };
    },
    sendRawTransaction: (raw) => client.sendRawTransaction({ serializedTransaction: raw }),
    async waitForReceipt(hash, timeoutMs) {
      try {
        return toReceipt(await client.waitForTransactionReceipt({ hash, timeout: timeoutMs }));
      } catch (err) {
        if (err instanceof WaitForTransactionReceiptTimeoutError) return null;
        throw err;
      }
    },
    async getReceipt(hash) {
      try {
        return toReceipt(await client.getTransactionReceipt({ hash }));
      } catch (err) {
        if (err instanceof TransactionReceiptNotFoundError) return null;
        throw err;
      }
    },
    async getTransaction(hash) {
      try {
        const t = await client.getTransaction({ hash });
        return { hash: t.hash, input: t.input, nonce: t.nonce, from: t.from };
      } catch (err) {
        if (err instanceof TransactionNotFoundError) return null;
        throw err;
      }
    },
    getTransactionCount: (addr, blockTag) => client.getTransactionCount({ address: addr, blockTag }),
  };
}
