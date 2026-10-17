"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import Icon from "./Icon.tsx";

/** Vuelve a pedir la página al servidor (por ejemplo, para releer saldos de Celo). */
export default function RefreshButton({ label = "Actualizar" }: { label?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" className="btn-link inline" onClick={() => start(() => router.refresh())} disabled={pending} aria-busy={pending}>
      {pending ? <span className="spin" aria-hidden /> : <Icon name="refresh" size={14} stroke={2} />}
      {label}
    </button>
  );
}
