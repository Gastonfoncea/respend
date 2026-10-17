"use client";
// Monto que cuenta desde 0 hasta `cents` (centavos, enteros). Respeta "reducir movimiento".
import { useEffect, useState } from "react";
import { Amount } from "./ui.tsx";

export default function CountUp({ cents, ms = 900 }: { cents: number; ms?: number }) {
  const [value, setValue] = useState(cents);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      const eased = 1 - Math.pow(1 - k, 3);
      setValue(Math.round(cents * eased));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    setValue(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cents, ms]);
  return <Amount cents={value} />;
}
