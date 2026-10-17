"use client";
// Polling suave: vuelve a pedir la página al servidor cada `ms` mientras `active` y la pestaña esté visible.
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function AutoRefresh({ ms = 10_000, active = true }: { ms?: number; active?: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, ms);
    return () => clearInterval(id);
  }, [ms, active, router]);
  return null;
}
