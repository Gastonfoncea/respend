"use client";
// Botón "mantené para confirmar". Envía el formulario recién cuando se completa la barra.
// Es una fricción intencional para pagos; la protección real contra doble pago está en el servidor (§7).
import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

export default function HoldButton({
  label,
  pendingLabel = "Pagando…",
  holdMs = 1000,
  disabled = false,
}: {
  label: string;
  pendingLabel?: string;
  holdMs?: number;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  const ref = useRef<HTMLButtonElement>(null);
  const raf = useRef<number | null>(null);
  const start = useRef(0);
  const [p, setP] = useState(0);
  const [fired, setFired] = useState(false);

  useEffect(() => {
    if (!pending) setFired(false);
  }, [pending]);

  useEffect(() => () => stop(), []);

  function stop() {
    if (raf.current != null) cancelAnimationFrame(raf.current);
    raf.current = null;
  }

  function begin() {
    if (disabled || pending || fired) return;
    const form = ref.current?.form;
    // Si falta tildar algo, que el navegador lo diga antes de empezar.
    if (form && !form.checkValidity()) {
      form.reportValidity();
      return;
    }
    start.current = performance.now();
    const tick = (t: number) => {
      const v = Math.min(1, (t - start.current) / holdMs);
      setP(v);
      if (v >= 1) {
        stop();
        setFired(true);
        if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(12);
        ref.current?.form?.requestSubmit();
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }

  function cancel() {
    if (fired) return;
    stop();
    setP(0);
  }

  const busy = pending || fired;
  const holding = p > 0 && !busy;
  return (
    <button
      ref={ref}
      type="button"
      className={`btn hold ${holding ? "is-holding" : ""} ${busy ? "is-done" : ""}`}
      style={{ "--p": busy ? 1 : p, transition: p === 0 ? "none" : undefined } as React.CSSProperties}
      disabled={disabled}
      aria-busy={busy}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        begin();
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if ((e.key === " " || e.key === "Enter") && !e.repeat) {
          e.preventDefault();
          begin();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === " " || e.key === "Enter") cancel();
      }}
    >
      <span className="hold-label">
        {busy ? (
          <span className="inline">
            <span className="spin" aria-hidden /> {pendingLabel}
          </span>
        ) : holding ? (
          "Soltá para cancelar"
        ) : (
          label
        )}
      </span>
    </button>
  );
}
