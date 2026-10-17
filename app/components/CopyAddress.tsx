"use client";
import { useState } from "react";

export function shortAddr(a: string): string {
  return a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export default function CopyAddress({ address, full = false }: { address: string; full?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="addr">
      <code title={address}>{full ? address : shortAddr(address)}</code>
      <button
        type="button"
        className="copy"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(address);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* sin permiso de portapapeles */
          }
        }}
        aria-label="Copiar dirección"
      >
        {copied ? "Copiado" : "Copiar"}
      </button>
    </span>
  );
}
