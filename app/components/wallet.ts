// Lectura de saldos de la wallet del agente (solo lectura contra Celo). Server-only.
import * as server from "@/lib/server.ts";
import { WARS_ADDRESS } from "@/lib/config.ts";

export interface WalletInfo {
  address: string | null;
  wars: bigint | null;
  celo: bigint | null;
  error: string | null;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
}

export async function walletInfo(address: string | null): Promise<WalletInfo> {
  if (!address) return { address: null, wars: null, celo: null, error: null };
  try {
    const c = server.chain();
    const [wars, celo] = await withTimeout(
      Promise.all([c.getTokenBalance(WARS_ADDRESS, address as `0x${string}`), c.getNativeBalance(address as `0x${string}`)]),
      6000,
    );
    return { address, wars, celo, error: null };
  } catch {
    return { address, wars: null, celo: null, error: "No se pudo leer el saldo de Celo." };
  }
}

/** Mínimo de CELO para cubrir comisiones de red de algunos pagos (0,05 CELO). */
export const MIN_CELO_WEI = 5n * 10n ** 16n;
/** CELO sugerido para cargar (2 CELO alcanza para muchos pagos). */
export const SUGGESTED_CELO = 2;
