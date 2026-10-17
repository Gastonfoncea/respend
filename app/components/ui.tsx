// Piezas visuales sin estado (sirven en server y client components).
import Link from "next/link";
import { formatArs } from "@/lib/money.ts";
import type { PaymentMode } from "@/lib/config.ts";
import Icon from "./Icon.tsx";

/** "$ 48.500,00" → "$48.500" + ",00". Recibe centavos (enteros). */
export function Amount({ cents, size, muted, suffix }: { cents: number | null; size?: "sm" | "md" | "xl"; muted?: boolean; suffix?: string }) {
  if (cents == null) {
    return (
      <p className={`amount is-muted ${size ? `amount-${size}` : ""}`}>
        <span className="amount-main">—</span>
      </p>
    );
  }
  const [main, dec] = formatArs(cents).replace("$ ", "$").split(",");
  return (
    <p className={`amount ${muted ? "is-muted" : ""} ${size ? `amount-${size}` : ""}`}>
      <span className="amount-main">{main}</span>
      <span className="amount-dec">
        ,{dec}
        {suffix}
      </span>
    </p>
  );
}

/** Monto compacto para listas: "$48.500". */
export function shortArs(cents: number | null): string {
  if (cents == null) return "—";
  return formatArs(cents).replace("$ ", "$").replace(/,00$/, "");
}

/** Miles abreviados para leyendas: 120000 pesos → "120k". */
export function kArs(cents: number): string {
  const pesos = Math.floor(cents / 100);
  if (pesos >= 1000) return `${Math.floor(pesos / 1000)}k`;
  return String(pesos);
}

export function ModeTag({ mode }: { mode: PaymentMode }) {
  return mode === "mainnet" ? (
    <span className="mode mode-mainnet" title="Los pagos mueven wARS reales en Celo">
      Mainnet
    </span>
  ) : (
    <span className="mode mode-sim" title="Los pagos no generan transacciones en Celo">
      Simulado
    </span>
  );
}

export function TopBar({ title, back = "/evento", backIcon = "back", mode }: { title: string; back?: string; backIcon?: "back" | "x"; mode: PaymentMode }) {
  return (
    <header className="topbar">
      <div className="topbar-start">
        <Link href={back} className="icon-btn" aria-label="Volver">
          <Icon name={backIcon} size={22} />
        </Link>
      </div>
      <div className="topbar-title">{title}</div>
      <div className="topbar-end">
        <ModeTag mode={mode} />
      </div>
    </header>
  );
}

export function Rows({ children }: { children: React.ReactNode }) {
  return <dl className="rows">{children}</dl>;
}

export function Row({ k, children, mono, tone, tag }: { k: string; children: React.ReactNode; mono?: boolean; tone?: Tone; tag?: string }) {
  return (
    <div className="row">
      <dt className="row-k">{k}</dt>
      {tag && <span className="tag">{tag}</span>}
      <dd className={`row-v ${mono ? "mono" : ""} ${tone ? toneClass(tone) : ""}`}>{children}</dd>
    </div>
  );
}

export type Tone = "green" | "amb" | "red" | "dim" | "cy";
export function toneClass(t: Tone): string {
  return { green: "t-green", amb: "t-amb", red: "t-red", dim: "dim", cy: "t-cy" }[t];
}

export interface TickSegment {
  cents: number;
  kind: "paid" | "live" | "over" | "rest";
}

/** Barra de ticks: reparte `count` rayitas en proporción a cada segmento (enteros). */
export function Ticks({ segments, total, count = 50, height }: { segments: TickSegment[]; total: number; count?: number; height?: number }) {
  const ticks: TickSegment["kind"][] = [];
  if (total > 0) {
    for (const s of segments) {
      const n = Math.round((Math.max(0, s.cents) * count) / total);
      for (let i = 0; i < n && ticks.length < count; i++) ticks.push(s.kind);
    }
  }
  while (ticks.length < count) ticks.push("rest");
  return (
    <div className="ticks" style={height ? ({ "--tick-h": `${height}px` } as React.CSSProperties) : undefined} aria-hidden>
      {ticks.map((k, i) => (
        <i key={i} className={`tick ${k === "rest" ? "" : `is-${k}`}`} style={{ "--i": i } as React.CSSProperties} />
      ))}
    </div>
  );
}

/** Dirección completa en grupos de 4 para poder verificarla a ojo. */
export function GroupedAddress({ address }: { address: string }) {
  const body = address.startsWith("0x") ? address.slice(2) : address;
  const groups = body.match(/.{1,4}/g) ?? [];
  return (
    <p className="addr-grouped" aria-label={address}>
      <span className="x">0x</span>
      {groups.map((g, i) => (
        <span key={i}>{g}</span>
      ))}
    </p>
  );
}

export function StateBadge({ kind }: { kind: "ok" | "bad" | "warn" }) {
  const icon = kind === "ok" ? "check" : kind === "bad" ? "x" : "q";
  return (
    <div className={`state-badge state-${kind}`}>
      <Icon name={icon} size={26} stroke={2.4} />
    </div>
  );
}

export function SectionLabel({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <h2 className="section-label">
      <span>{children}</span>
      {action}
    </h2>
  );
}

export function Stepper({ active, labels }: { active: number; labels: [string, string, string] }) {
  return (
    <div className="stepper">
      {labels.map((l, i) => {
        const st = i < active ? "done" : i === active ? "now" : "next";
        const lit = st === "done" ? 12 : st === "now" ? 5 : 0;
        return (
          <div key={l} className={`step is-${st}`}>
            <div className="ticks">
              {Array.from({ length: 12 }, (_, k) => (
                <i key={k} className={`tick ${k < lit ? "is-live" : ""}`} style={{ "--i": i * 12 + k } as React.CSSProperties} />
              ))}
            </div>
            <span className="step-label">{l}</span>
          </div>
        );
      })}
    </div>
  );
}

export function shortAddr(a: string): string {
  return a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export function shortHash(h: string): string {
  return h.length > 14 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h;
}

export function hhmm(iso: string | null): string {
  return iso ? iso.slice(11, 16) : "";
}
