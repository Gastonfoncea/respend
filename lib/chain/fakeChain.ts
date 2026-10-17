// Cadena falsa en memoria para tests. Simula nonces, mempool, minado, receipts y logs Transfer.
// Nunca toca la red.
import {
  decodeFunctionData,
  encodeAbiParameters,
  erc20Abi,
  getAddress,
  keccak256,
  pad,
  parseTransaction,
  type Address,
  type Hex,
} from "viem";
import type { ChainClient, ChainLog, ChainReceipt, ChainTx } from "./clients.ts";

const TRANSFER_TOPIC = keccak256(new TextEncoder().encode("Transfer(address,address,uint256)"));

export type SendBehavior = "ok" | "network_error" | "hang" | "drop";

export interface FakeChainOptions {
  chainId?: number;
  token: Address;
  tokenMeta?: { decimals: number; symbol: string; name: string };
  sender: Address;
}

interface Pending {
  hash: Hex;
  raw: Hex;
  nonce: number;
  input: Hex;
  to: Address;
}

export class FakeChain implements ChainClient {
  chainId: number;
  token: Address;
  tokenMeta: { decimals: number; symbol: string; name: string };
  sender: Address;
  latestNonce = 0;
  mempool = new Map<Hex, Pending>();
  mined = new Map<Hex, { receipt: ChainReceipt; tx: ChainTx }>();
  sendBehavior: SendBehavior = "ok";
  autoMine = true;
  revertNext = false;
  /** Para tests de verify: altera el log Transfer del próximo minado. */
  tamperLog: ((log: { to: Address; value: bigint }) => { to: Address; value: bigint }) | null = null;
  sentRaw: Hex[] = [];
  block = 1000n;

  constructor(opts: FakeChainOptions) {
    this.chainId = opts.chainId ?? 42220;
    this.token = getAddress(opts.token);
    this.tokenMeta = opts.tokenMeta ?? { decimals: 18, symbol: "wARS", name: "Peso Argentino" };
    this.sender = getAddress(opts.sender);
  }

  async getChainId() {
    return this.chainId;
  }
  async readTokenMeta() {
    return this.tokenMeta;
  }
  async getTokenBalance() {
    return 10n ** 24n;
  }
  async getNativeBalance() {
    return 10n ** 18n;
  }
  async prepareTransaction() {
    return { nonce: this.latestNonce + this.mempool.size, gas: 100_000n, maxFeePerGas: 30_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n };
  }

  async sendRawTransaction(raw: Hex): Promise<Hex> {
    if (this.sendBehavior === "network_error") throw new Error("fetch failed: ECONNRESET");
    if (this.sendBehavior === "hang") return new Promise<Hex>(() => {});
    this.sentRaw.push(raw);
    const hash = keccak256(raw);
    if (this.sendBehavior === "drop") return hash; // el nodo la acepta pero nunca se mina
    const tx = parseTransaction(raw);
    if (tx.nonce !== this.latestNonce + this.mempool.size && !this.mempool.has(hash)) {
      throw new Error(`nonce too low/high: ${tx.nonce}`);
    }
    if (!this.mempool.has(hash) && !this.mined.has(hash)) {
      this.mempool.set(hash, { hash, raw, nonce: tx.nonce!, input: tx.data ?? "0x", to: getAddress(tx.to!) });
    }
    if (this.autoMine) this.mineAll();
    return hash;
  }

  /** Consume un nonce con otra transacción (por ejemplo, enviada desde otra herramienta). */
  consumeNonceExternally() {
    this.latestNonce += 1;
  }

  mineAll() {
    for (const p of [...this.mempool.values()].sort((a, b) => a.nonce - b.nonce)) {
      this.mempool.delete(p.hash);
      this.block += 1n;
      const reverted = this.revertNext;
      this.revertNext = false;
      const logs: ChainLog[] = [];
      if (!reverted && p.to === this.token) {
        const { args } = decodeFunctionData({ abi: erc20Abi, data: p.input });
        if (args && args.length === 2) {
          let out = { to: getAddress(args[0] as Address), value: args[1] as bigint };
          if (this.tamperLog) {
            out = this.tamperLog(out);
            this.tamperLog = null;
          }
          logs.push({
            address: this.token,
            topics: [TRANSFER_TOPIC, pad(this.sender), pad(out.to)],
            data: encodeAbiParameters([{ type: "uint256" }], [out.value]),
          });
        }
      }
      this.latestNonce = Math.max(this.latestNonce, p.nonce + 1);
      this.mined.set(p.hash, {
        receipt: { transactionHash: p.hash, status: reverted ? "reverted" : "success", blockNumber: this.block, from: this.sender, logs },
        tx: { hash: p.hash, input: p.input, nonce: p.nonce, from: this.sender },
      });
    }
  }

  async waitForReceipt(hash: Hex) {
    return this.mined.get(hash)?.receipt ?? null;
  }
  async getReceipt(hash: Hex) {
    return this.mined.get(hash)?.receipt ?? null;
  }
  async getTransaction(hash: Hex) {
    const m = this.mined.get(hash);
    if (m) return m.tx;
    const p = this.mempool.get(hash);
    return p ? { hash: p.hash, input: p.input, nonce: p.nonce, from: this.sender } : null;
  }
  async getTransactionCount(_addr: Address, blockTag: "latest" | "pending") {
    return blockTag === "latest" ? this.latestNonce : this.latestNonce + this.mempool.size;
  }
}
