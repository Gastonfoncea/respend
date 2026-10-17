"use client";
import { useState } from "react";
import Icon from "./Icon.tsx";

export function shortAddr(a: string): string {
  return a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

/** Dirección abreviada (o completa) con copiar al tocar. */
export default function CopyAddress({
  address,
  full = false,
  label,
  className = "copy mono",
}: {
  address: string;
  full?: boolean;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`${className} ${copied ? "is-copied" : ""}`}
      title={address}
      aria-label={`Copiar ${address}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(address);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* sin permiso de portapapeles */
        }
      }}
    >
      <span>{copied ? "Copiada" : (label ?? (full ? address : shortAddr(address)))}</span>
      <span className="copy-icon">
        <Icon name={copied ? "check" : "copy"} size={15} stroke={2} />
      </span>
    </button>
  );
}
