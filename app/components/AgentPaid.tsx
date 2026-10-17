// Momentos del pago automático: "El agente está pagando…" y "Te pagó el agente".
// Componentes de servidor; la animación del monto vive en CountUp (cliente).
import { centsToWei, formatWars } from "@/lib/money.ts";
import { txUrl } from "@/lib/config.ts";
import type { PaymentRow } from "@/lib/types.ts";
import CountUp from "./CountUp.tsx";
import Icon from "./Icon.tsx";
import { shortAddr, shortHash } from "./ui.tsx";

export function AgentPaying({ cents, recipient, mainnet }: { cents: number | null; recipient: string; mainnet: boolean }) {
  return (
    <section className="agent-paying rise" role="status" aria-live="polite">
      <div className="agent-head">
        <span className="agent-dot" aria-hidden />
        <span className="label">Agente</span>
      </div>
      <h2 className="display h2" style={{ margin: 0 }}>
        El agente está pagando…
      </h2>
      <p className="mono dim" style={{ margin: 0 }}>
        {cents != null ? formatWars(centsToWei(cents)) : "—"} → {shortAddr(recipient)} · {mainnet ? "Celo mainnet" : "simulado"}
      </p>
      <div className="paying-bar" aria-hidden>
        <span />
      </div>
      <p className="field-help" style={{ margin: 0 }}>
        Entra en el pago automático: sin alertas y dentro del límite. Esta pantalla se actualiza sola.
      </p>
    </section>
  );
}

export function AgentPaidHero({
  cents,
  payment,
  seconds,
  who,
}: {
  cents: number | null;
  payment: PaymentRow | null;
  seconds: number | null;
  who: "collaborator" | "organizer";
}) {
  const mainnet = payment?.mode === "mainnet";
  return (
    <section className="stack gap-4 agent-paid" style={{ paddingTop: 16 }}>
      <svg className="check-draw" viewBox="0 0 52 52" width="52" height="52" aria-hidden>
        <circle cx="26" cy="26" r="24" />
        <path d="M15 27 l7 7 l15 -16" />
      </svg>
      <div className="sp-16" />
      <p className="label t-green">{who === "collaborator" ? "Te pagó el agente" : "Pagó el agente"}</p>
      {cents != null ? <CountUp cents={cents} /> : null}
      <p className="mono dim" style={{ margin: 0 }}>
        {cents != null ? formatWars(centsToWei(cents)) : ""}
        {seconds != null ? ` · en ${seconds} s` : ""}
        {mainnet ? "" : " · simulado"}
      </p>
      {payment?.tx_hash && mainnet && (
        <a className="small inline" href={txUrl(payment.tx_hash)} target="_blank" rel="noreferrer" style={{ marginTop: 6 }}>
          Ver en Celoscan · {shortHash(payment.tx_hash)} <Icon name="ext" size={14} stroke={2} />
        </a>
      )}
    </section>
  );
}

/** Por qué el agente pudo pagar solo (para el organizador). */
export function AutoPayReasons({ limitCents }: { limitCents: number | null }) {
  const items = [
    limitCents != null ? `Monto dentro del límite automático (${(limitCents / 100).toLocaleString("es-AR")} wARS)` : "Monto dentro del límite automático",
    "Sin alertas: todas las reglas pasan, sin duplicados ni instrucciones sospechosas",
    "Dentro del tope de 24 h",
    "Sin intervención tuya en este gasto",
  ];
  return (
    <ul className="agent-checks">
      {items.map((t, i) => (
        <li key={t} className="rise t-green" style={{ "--i": i + 1 } as React.CSSProperties}>
          <Icon name="check" size={14} stroke={2.4} />
          <span className="small">{t}</span>
        </li>
      ))}
    </ul>
  );
}
