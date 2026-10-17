// ÚNICO lugar que lee AGENT_PRIVATE_KEY. La clave nunca se imprime, se loguea ni se manda al modelo.
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { Address } from "viem";

export class SignerError extends Error {}

export function getAgentAccount(env: Record<string, string | undefined> = process.env): PrivateKeyAccount | null {
  const raw = env.AGENT_PRIVATE_KEY?.trim();
  if (!raw) return null;
  const key = (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    // No incluir la clave en el mensaje.
    throw new SignerError("AGENT_PRIVATE_KEY tiene un formato inválido (se esperan 64 caracteres hex).");
  }
  return privateKeyToAccount(key);
}

export function getAgentAddress(env: Record<string, string | undefined> = process.env): Address | null {
  try {
    return getAgentAccount(env)?.address ?? null;
  } catch {
    return null;
  }
}
