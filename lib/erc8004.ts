// ERC-8004: registro de identidad del agente. El archivo de registro va como data: URI (sin hosting).
import { IDENTITY_REGISTRY } from "./config.ts";

export const IDENTITY_REGISTRY_ABI = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentURI", type: "string" }],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    type: "event",
    name: "Registered",
    inputs: [
      { name: "agentId", type: "uint256", indexed: true },
      { name: "agentURI", type: "string", indexed: false },
      { name: "owner", type: "address", indexed: true },
    ],
  },
] as const;

export interface Registration {
  type: string;
  name: string;
  description: string;
  services: { name: string; endpoint: string }[];
  active: boolean;
  supportedTrust: string[];
}

export function buildRegistration(): Registration {
  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "Respend",
    description:
      "Agente de rendición de gastos para equipos cripto de LatAm: lee comprobantes, los contrasta con la política del evento, explica su recomendación y, con aprobación humana, reembolsa en wARS sobre Celo.",
    services: [{ name: "web", endpoint: "https://github.com/gastonfoncea/respend" }],
    active: true,
    supportedTrust: ["reputation"],
  };
}

export function toDataUri(reg: Registration): string {
  return `data:application/json;base64,${Buffer.from(JSON.stringify(reg), "utf8").toString("base64")}`;
}

export function fromDataUri(uri: string): unknown {
  const prefix = "data:application/json;base64,";
  if (!uri.startsWith(prefix)) throw new Error("No es un data URI JSON base64");
  return JSON.parse(Buffer.from(uri.slice(prefix.length), "base64").toString("utf8"));
}

export function agentScanUrl(agentId: bigint | number): string {
  return `https://www.8004scan.io/agents/celo/${agentId}`;
}

export { IDENTITY_REGISTRY };
