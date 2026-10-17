// Registro ERC-8004 del agente en Celo mainnet.
//   npm run agent:register                 → dry-run: arma el archivo de registro y simula register() (eth_call) + gas
//   npm run agent:register -- --offline    → solo muestra el JSON y el data: URI (sin red)
//   npm run agent:register -- --send       → ENVÍA la transacción (pide confirmación). Requiere autorización humana.
import readline from "node:readline/promises";
import { createWalletClient, http, parseEventLogs } from "viem";
import { celo } from "viem/chains";
import { withAttribution as attributionExtension } from "@celo/attribution-tags";
import { createPublicCeloClient } from "../lib/chain/clients.ts";
import { getAgentAccount } from "../lib/chain/signer.ts";
import { assertAttributionCode } from "../lib/chain/attribution.ts";
import { CHAIN_ID, RPC_URL, txUrl } from "../lib/config.ts";
import { IDENTITY_REGISTRY, IDENTITY_REGISTRY_ABI, agentScanUrl, buildRegistration, toDataUri } from "../lib/erc8004.ts";
import { formatBalance } from "../lib/money.ts";

const send = process.argv.includes("--send");
const offline = process.argv.includes("--offline");

const registration = buildRegistration();
const agentURI = toDataUri(registration);
console.log("Archivo de registro:");
console.log(JSON.stringify(registration, null, 2));
console.log(`\nagentURI (${agentURI.length} caracteres):\n${agentURI}\n`);
if (offline) process.exit(0);

const account = getAgentAccount();
if (!account) {
  console.error("Falta AGENT_PRIVATE_KEY (creala con npm run wallet:new). Sin wallet solo se puede usar --offline.");
  process.exit(1);
}
const code = assertAttributionCode();
const client = createPublicCeloClient();
const chainId = await client.getChainId();
if (chainId !== CHAIN_ID) {
  console.error(`La red responde chainId ${chainId}, se esperaba ${CHAIN_ID}. Abortado.`);
  process.exit(1);
}
console.log(`Registry: ${IDENTITY_REGISTRY} · desde ${account.address} · tag ERC-8021 ${code}`);

const { request, result } = await client.simulateContract({
  account,
  address: IDENTITY_REGISTRY,
  abi: IDENTITY_REGISTRY_ABI,
  functionName: "register",
  args: [agentURI],
});
const gas = await client.estimateContractGas({
  account,
  address: IDENTITY_REGISTRY,
  abi: IDENTITY_REGISTRY_ABI,
  functionName: "register",
  args: [agentURI],
});
const fees = await client.estimateFeesPerGas();
const balance = await client.getBalance({ address: account.address });
console.log(`Simulación OK (eth_call). agentId tentativo: ${result} (el real se lee del evento Registered).`);
console.log(`Gas estimado: ${gas} · costo máx. aprox.: ${formatBalance(gas * fees.maxFeePerGas, "CELO", 6)} · saldo: ${formatBalance(balance, "CELO", 4)}`);

if (!send) {
  console.log("\nDry-run: no se envió nada. Para registrar de verdad: npm run agent:register -- --send");
  process.exit(0);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question('Esto envía una transacción REAL a Celo mainnet. Escribí "REGISTRAR" para continuar: ');
rl.close();
if (answer.trim() !== "REGISTRAR") {
  console.log("Cancelado.");
  process.exit(1);
}

const wallet = createWalletClient({ account, chain: celo, transport: http(RPC_URL) }).extend(attributionExtension(code));
const hash = await wallet.writeContract(request);
console.log(`Enviada: ${txUrl(hash)}`);
const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
if (receipt.status !== "success") {
  console.error("La transacción revirtió.");
  process.exit(1);
}
const [registered] = parseEventLogs({ abi: IDENTITY_REGISTRY_ABI, eventName: "Registered", logs: receipt.logs });
if (!registered) {
  console.error("No se encontró el evento Registered en el receipt. Revisá la transacción en Celoscan.");
  process.exit(1);
}
console.log(`✓ Registrado. agentId ${registered.args.agentId} · owner ${registered.args.owner}`);
console.log(`8004scan: ${agentScanUrl(registered.args.agentId)}`);
console.log(`Celoscan: ${txUrl(hash)}`);
console.log(`Verificá el tag: npm run tx:verify -- ${hash}`);
