// Verifica una transacción en Celo mainnet (solo lectura): estado, logs Transfer de wARS y tag ERC-8021.
//   npm run tx:verify -- 0xHASH
import { verifyTx } from "@celo/attribution-tags";
import { createPublicCeloClient } from "../lib/chain/clients.ts";
import { transferLogsOf } from "../lib/chain/token.ts";
import { attributionCodes } from "../lib/chain/attribution.ts";
import { ATTRIBUTION_CODE, WARS_ADDRESS, txUrl } from "../lib/config.ts";
import { formatWars } from "../lib/money.ts";

const hash = process.argv.slice(2).find((a) => /^0x[0-9a-fA-F]{64}$/.test(a)) as `0x${string}` | undefined;
if (!hash) {
  console.error("Uso: npm run tx:verify -- 0x<hash de 64 caracteres hex>");
  process.exit(1);
}
const client = createPublicCeloClient();
const [receipt, tx] = await Promise.all([client.getTransactionReceipt({ hash }), client.getTransaction({ hash })]);
console.log(`Transacción: ${txUrl(hash)}`);
console.log(`Estado: ${receipt.status === "success" ? "✓ éxito" : "✗ revertida"} · bloque ${receipt.blockNumber} · de ${receipt.from}`);
const transfers = transferLogsOf(
  receipt.logs.map((l) => ({ address: l.address, topics: l.topics as `0x${string}`[], data: l.data })),
  WARS_ADDRESS,
);
if (!transfers.length) console.log("Transfer de wARS: ninguno");
for (const t of transfers) console.log(`Transfer de wARS: ${t.from} → ${t.to} · ${formatWars(t.value)}`);
const codes = attributionCodes(tx.input);
console.log(`Tag ERC-8021 (calldata): ${codes.length ? codes.join(", ") : "ninguno"} ${codes.includes(ATTRIBUTION_CODE) ? "✓ incluye " + ATTRIBUTION_CODE : ""}`);
const sdk = await verifyTx({ client, hash });
console.log(`verifyTx del SDK: ${sdk ? JSON.stringify(sdk) : "sin tag"}`);
