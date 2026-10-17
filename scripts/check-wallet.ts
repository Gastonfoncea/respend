// Lee de Celo mainnet (solo lectura): red, datos del token wARS y saldos de una dirección.
//   npm run wallet:check                 → usa la wallet del agente (AGENT_PRIVATE_KEY en .env.local)
//   npm run wallet:check -- 0xDIRECCION  → cualquier dirección
import { getAddress, isAddress } from "viem";
import { createRealChain } from "../lib/chain/clients.ts";
import { getAgentAddress } from "../lib/chain/signer.ts";
import { CHAIN_ID, RPC_URL, WARS_ADDRESS, addressUrl } from "../lib/config.ts";
import { formatBalance } from "../lib/money.ts";

const arg = process.argv.slice(2).find((a) => a.startsWith("0x"));
let address: `0x${string}` | null = null;
if (arg) {
  if (!isAddress(arg)) {
    console.error("Dirección inválida:", arg);
    process.exit(1);
  }
  address = getAddress(arg);
} else {
  address = getAgentAddress();
}
if (!address) {
  console.error("No hay dirección: pasá una (npm run wallet:check -- 0x…) o creá la wallet con npm run wallet:new.");
  process.exit(1);
}

const chain = createRealChain();
const chainId = await chain.getChainId();
console.log(`RPC: ${RPC_URL} · chainId ${chainId} ${chainId === CHAIN_ID ? "(Celo mainnet ✓)" : "(¡no es Celo mainnet!)"}`);
const meta = await chain.readTokenMeta(WARS_ADDRESS);
console.log(`Token: ${meta.name} (${meta.symbol}) · ${meta.decimals} decimales · ${WARS_ADDRESS}`);
const [wars, celo] = await Promise.all([chain.getTokenBalance(WARS_ADDRESS, address), chain.getNativeBalance(address)]);
console.log(`Dirección: ${address}`);
console.log(`Saldo wARS: ${formatBalance(wars, "wARS")}`);
console.log(`Saldo CELO: ${formatBalance(celo, "CELO", 4)}`);
console.log(`Celoscan: ${addressUrl(address)}`);
