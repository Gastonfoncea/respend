// Genera la wallet del agente y escribe la clave en .env.local SIN imprimirla. Imprime solo la dirección.
// Correlo en tu máquina (no en un servidor compartido):  npm run wallet:new
// Opcional: --out <ruta> para escribir en otro archivo.
import fs from "node:fs";
import path from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const argIdx = process.argv.indexOf("--out");
const envFile = path.resolve(argIdx > 0 ? process.argv[argIdx + 1] : ".env.local");

const existing = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : "";
if (/^\s*AGENT_PRIVATE_KEY\s*=\s*\S+/m.test(existing)) {
  console.error(`${envFile} ya tiene AGENT_PRIVATE_KEY. No se sobrescribe (podrías perder acceso a fondos).`);
  console.error("Si de verdad querés otra wallet, mové esa línea a un lugar seguro y volvé a correr el comando.");
  process.exit(1);
}

const key = generatePrivateKey();
const address = privateKeyToAccount(key).address;
const sep = existing && !existing.endsWith("\n") ? "\n" : "";
const block = `${sep}# Wallet del agente generada con npm run wallet:new (${new Date().toISOString().slice(0, 10)}). No compartir.\nAGENT_PRIVATE_KEY=${key}\n`;
fs.writeFileSync(envFile, existing + block, { mode: 0o600 });
fs.chmodSync(envFile, 0o600);

console.log("Wallet del agente creada. La clave quedó en", envFile, "(permisos 600, no se imprime).");
console.log("Dirección:", address);
console.log(`Celoscan: https://celoscan.io/address/${address}`);
console.log("Próximo paso: fondeala con wARS (para los reembolsos) y un poco de CELO (para el gas).");
