"use client";
// "Nuevo gasto" en dos tiempos: el colaborador elige la foto, el agente la lee al instante (sin guardar nada)
// y responde con lo que entendió y una sola pregunta. La respuesta es la descripción del gasto.
// Lo que vale es la evaluación al enviar; esto es una ayuda para no presentar algo que no entra.
import { startTransition, useActionState, useEffect, useState } from "react";
import { previewExpenseAction, submitExpenseAction } from "../actions/requests.ts";
import type { PreviewResult } from "@/lib/workflow.ts";
import Icon from "../components/Icon.tsx";
import ReceiptPicker, { Reading } from "../components/ReceiptPicker.tsx";
import SubmitButton from "../components/SubmitButton.tsx";

const VERDICT: Record<Extract<PreviewResult, { ok: true }>["verdict"], { tone: string; icon: "check" | "warn" | "x" }> = {
  fits: { tone: "t-green", icon: "check" },
  unclear: { tone: "t-amb", icon: "warn" },
  review: { tone: "t-amb", icon: "warn" },
  outside: { tone: "t-red", icon: "x" },
};

const ars = (cents: number | null) =>
  cents == null ? "—" : `$ ${(cents / 100).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function Composer({ canSubmit, aiReady }: { canSubmit: boolean; aiReady: boolean }) {
  const [state, dispatch, reading] = useActionState(previewExpenseAction, null);
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) return setUrl(null);
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  function onFile(f: File | null) {
    setFile(f);
    if (!f || !aiReady) return;
    const fd = new FormData();
    fd.set("receipt", f);
    startTransition(() => dispatch(fd));
  }

  const read = state?.ok ? state : null;
  // Sin IA (falta la key) o si la lectura falló, el colaborador igual puede describir y enviar.
  const showAsk = Boolean(file) && !reading && (read || state?.ok === false || !aiReady);
  const sendLabel = read && (read.verdict === "outside" || read.verdict === "review") ? "Enviar igual" : "Enviar a revisión";

  return (
    <form action={submitExpenseAction} className="stack gap-24" encType="multipart/form-data">
      <div className="rise">
        <ReceiptPicker onFile={onFile} />
      </div>

      {reading && <Reading preview={url} title="El agente está leyendo" />}

      {!reading && state?.ok === false && (
        <div className="notice notice-amb rise">
          <Icon name="warn" size={18} stroke={2} />
          <span>El agente no pudo leerlo ahora ({state.error}). Contá para qué fue y envialo igual: lo vuelve a intentar al recibirlo.</span>
        </div>
      )}

      {!reading && read && <AgentCard r={read} />}

      {showAsk && (
        <div className="stack gap-16 rise" style={{ "--i": 6 } as React.CSSProperties}>
          <label className="field">
            <span className="field-label agent-ask">{read?.question ?? "¿Para qué fue este gasto?"}</span>
            <input
              className="input"
              name="description"
              maxLength={1000}
              required
              autoFocus
              placeholder="Ej.: remís para llevar el proyector al venue"
            />
            <span className="field-help">Una línea alcanza. El agente lo suma a lo que leyó del ticket.</span>
          </label>
          <div className="actions">
            <SubmitButton pendingText="Enviando…" disabled={!canSubmit}>
              <Icon name="up" size={20} stroke={2} /> {sendLabel}
            </SubmitButton>
          </div>
        </div>
      )}
    </form>
  );
}

function AgentCard({ r }: { r: Extract<PreviewResult, { ok: true }> }) {
  const v = VERDICT[r.verdict];
  const rows: [string, string][] = [
    ["Comercio", r.fields.merchant ?? "—"],
    ["Fecha", r.fields.date ?? "—"],
    ["Total", ars(r.fields.amountCents)],
    ["Categoría", r.fields.category ?? "—"],
  ];
  return (
    <section className="agent-card rise" aria-live="polite">
      <div className="agent-head">
        <span className="agent-dot" aria-hidden />
        <span className="label">Agente</span>
        {r.fake && <span className="mono dim-2 small">· prueba sin IA</span>}
      </div>
      <p className={`agent-say ${v.tone}`}>
        <Icon name={v.icon} size={20} stroke={2.4} /> <span>{r.headline}</span>
      </p>
      {r.autoPay && (
        <p className={`small agent-autopay ${r.autoPay.startsWith("Es de") ? "t-green" : "dim"}`} style={{ margin: 0 }}>
          {r.autoPay}
        </p>
      )}
      <dl className="agent-read">
        {rows.map(([k, val], i) => (
          <div key={k} className="agent-row rise" style={{ "--i": i + 1 } as React.CSSProperties}>
            <dt>{k}</dt>
            <dd style={k === "Categoría" ? { textTransform: "capitalize" } : undefined}>{val}</dd>
          </div>
        ))}
      </dl>
      <ul className="agent-checks">
        {r.checks
          .filter((c) => c.ok !== true || ["date_in_range", "amount_le_cap", "category_allowed"].includes(c.rule))
          .map((c, i) => (
            <li key={c.rule} className={`rise ${c.ok === true ? "t-green" : c.ok === false ? "t-red" : "t-amb"}`} style={{ "--i": i + 5 } as React.CSSProperties}>
              <Icon name={c.ok === true ? "check" : c.ok === false ? "x" : "warn"} size={14} stroke={2.4} />
              <span className="small">{c.detail}</span>
            </li>
          ))}
      </ul>
      {r.suspicious.length > 0 && (
        <p className="small t-amb" style={{ margin: 0 }}>
          Texto sospechoso en el ticket (ignorado): “{r.suspicious[0]}”
        </p>
      )}
      <p className="field-help" style={{ margin: 0 }}>
        Es una lectura previa: la decisión se toma al enviarlo, con las reglas del pago automático o la aprobación del organizador.
      </p>
    </section>
  );
}
