"use client";
// Ingreso. Mobile: elegir rol → código (dos pasos). Desktop: marca a la izquierda, selector + código a la derecha.
import { useState } from "react";
import type { Role } from "@/lib/types.ts";
import { login } from "../actions/session.ts";
import Icon from "./Icon.tsx";
import SubmitButton from "./SubmitButton.tsx";

const ROLES: { role: Role; title: string; sub: string; icon: "cam" | "ok"; hint: string }[] = [
  { role: "collaborator", title: "Cargo gastos", sub: "Colaborador", icon: "cam", hint: "Te lo pasó el organizador." },
  { role: "organizer", title: "Reviso y pago", sub: "Organizador", icon: "ok", hint: "Te lo dio quien armó el evento." },
];

// Alturas fijas (no aleatorias) para que server y client rendericen igual.
const WAVE = Array.from({ length: 64 }, (_, i) => Math.round(28 + 72 * Math.abs(Math.sin(i * 0.37) * Math.cos(i * 0.11))));

export default function LoginFlow({
  initialRole,
  error,
  eventName,
  modeTag,
}: {
  initialRole: Role | null;
  error: string | null;
  eventName: string;
  modeTag: React.ReactNode;
}) {
  const [role, setRole] = useState<Role | null>(initialRole);
  const [show, setShow] = useState(false);
  const current = ROLES.find((r) => r.role === role);

  return (
    <div className="login">
      <section className={`login-hero ${role ? "hide-mobile" : ""}`}>
        <div className="between" style={{ alignItems: "center" }}>
          <span>
            <span className="hide-desktop dim" style={{ fontWeight: 500 }}>
              {eventName}
            </span>
            <span className="brand only-desktop">respend</span>
          </span>
          {modeTag}
        </div>
        <div className="sp-32 hide-desktop" />
        <h1 className="brand hide-desktop">respend</h1>
        <p className="login-tag">
          Subís el ticket. El agente lo revisa.
          <br />
          Una persona aprueba el pago.
        </p>
        <p className="login-claim">
          Subís el ticket.
          <br />
          El agente lo revisa.
          <br />
          Una persona paga.
        </p>
        <div>
          <div className="wave" aria-hidden>
            {WAVE.map((h, i) => (
              <i key={i} className={i >= 20 && i < 30 ? "is-lit" : ""} style={{ "--h": `${h}%`, "--i": i } as React.CSSProperties} />
            ))}
          </div>
          <p className="mono dim-2 only-desktop" style={{ marginTop: 20 }}>
            {eventName} · pagos en wARS sobre Celo
          </p>
        </div>
      </section>

      {!role && (
        <div className="login-panel hide-desktop">
          <p className="section-label">¿Cómo entrás?</p>
          {ROLES.map((r, i) => (
            <button key={r.role} type="button" className="role rise" style={{ "--i": i + 2 } as React.CSSProperties} onClick={() => setRole(r.role)}>
              <span className="role-icon">
                <Icon name={r.icon} size={22} stroke={2} />
              </span>
              <span className="role-text">
                <span className="role-title">{r.title}</span>
                <span className="role-sub">{r.sub}</span>
              </span>
              <Icon name="chev" size={18} stroke={2} className="dim-2" />
            </button>
          ))}
        </div>
      )}

      <div className={`login-right ${role ? "" : "hide-mobile"}`}>
        <form action={login} className="code-step">
          <div className="hide-desktop" style={{ paddingTop: 8 }}>
            <button type="button" className="icon-btn" aria-label="Elegir otro rol" onClick={() => setRole(null)}>
              <Icon name="back" size={22} />
            </button>
          </div>
          {current && (
            <div className="stack gap-8 hide-desktop" style={{ paddingTop: 32 }}>
              <span className="inline t-green" style={{ fontWeight: 500 }}>
                <Icon name={current.icon} size={16} stroke={2} /> {current.sub}
              </span>
              <h1 className="display h1">Código de acceso</h1>
              <p className="lead">{current.hint}</p>
            </div>
          )}

          <h1 className="display h1 only-desktop">Entrar</h1>
          <div className="seg only-desktop" role="radiogroup" aria-label="Rol">
            {ROLES.map((r) => (
              <button
                key={r.role}
                type="button"
                role="radio"
                aria-checked={role === r.role}
                className={`seg-item ${role === r.role ? "is-on" : ""}`}
                onClick={() => setRole(r.role)}
              >
                <Icon name={r.icon} size={18} stroke={2} /> {r.title}
              </button>
            ))}
          </div>

          <input type="hidden" name="role" value={role ?? ""} />
          <label className="field" style={{ marginTop: 28 }}>
            <span className="field-label only-desktop">Código de acceso</span>
            <span className="input-wrap">
              <input
                className={`input mono passcode ${error ? "is-error" : ""} ${show ? "is-shown" : ""}`}
                type={show ? "text" : "password"}
                name="passcode"
                required
                autoComplete="current-password"
                placeholder="Código"
                aria-invalid={!!error}
              />
              <button type="button" className="icon-btn input-suffix" aria-label={show ? "Ocultar código" : "Mostrar código"} onClick={() => setShow((v) => !v)}>
                <Icon name={show ? "eyeOff" : "eye"} size={20} />
              </button>
            </span>
            {error && <span className="field-error">{error}</span>}
          </label>
          <div className="push" />
          <SubmitButton pendingText="Entrando…" disabled={!role}>
            Entrar <Icon name="arrow" size={18} stroke={2} />
          </SubmitButton>
        </form>
      </div>
    </div>
  );
}
