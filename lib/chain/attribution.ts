// ERC-8021: sufijo de atribución al final del calldata. El código sale del repo (codeFromRepo).
import { codeFromRepo, fromDataSuffix, toDataSuffix } from "@celo/attribution-tags";
import { concat, type Hex } from "viem";
import { ATTRIBUTION_CODE, ATTRIBUTION_REPO } from "../config.ts";

export function assertAttributionCode(): string {
  const derived = codeFromRepo(ATTRIBUTION_REPO);
  if (derived !== ATTRIBUTION_CODE) {
    throw new Error(`El código de atribución configurado (${ATTRIBUTION_CODE}) no coincide con codeFromRepo (${derived}).`);
  }
  return derived;
}

export function attributionSuffix(): Hex {
  return toDataSuffix(assertAttributionCode()) as Hex;
}

/** calldata ++ sufijo ERC-8021 */
export function withAttribution(data: Hex): Hex {
  return concat([data, attributionSuffix()]);
}

export function attributionCodes(input: Hex | null | undefined): string[] {
  if (!input) return [];
  try {
    return fromDataSuffix(input)?.codes ?? [];
  } catch {
    return [];
  }
}

export function hasOurAttribution(input: Hex | null | undefined): boolean {
  return attributionCodes(input).includes(ATTRIBUTION_CODE);
}
