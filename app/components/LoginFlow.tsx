"use client";
// Ingreso con mail y contraseña. Mobile: elegir "Entrar" o "Crear cuenta" → formulario. Desktop: marca a la
// izquierda, selector + formulario a la derecha. Si todavía no hay organizador, solo se ofrece crear esa cuenta.
import { useState } from "react";
import { createAccount, login } from "../actions/session.ts";
import Icon from "./Icon.tsx";
import SubmitButton from "./SubmitButton.tsx";

export type LoginMode = "login" | "signup";

const MODES: { mode: LoginMode; title: string; sub: string; icon: "lock" | "user" }[] = [
  { mode: "login", title: "Entrar", sub: "Ya tengo cuenta", icon: "lock" },
  { mode: "signup", title: "Crear cuenta", sub: "El organizador me agregó al equipo", icon: "user" },
];

// Alturas fijas (no aleatorias) para que server y client rendericen igual.
const WAVE = Array.from({ length: 64 }, (_, i) => Math.round(28 + 72 * Math.abs(Math.sin(i * 0.37) * Math.cos(i * 0.11))));

export default function LoginFlow({
  initialMode,
  firstOrganizer,
  email,
  error,
  eventName,
  modeTag,
}: {
  initialMode: LoginMode | null;
  /** No hay nadie todavía: la primera cuenta es la del organizador. */
  firstOrganizer: boolean;
  email: string | null;
  error: string | null;
  eventName: string;
  modeTag: React.ReactNode;
}) {
  const [mode, setMode] = useState<LoginMode | null>(firstOrganizer ? "signup" : initialMode);
  const [show, setShow] = useState(false);
  const current = MODES.find((m) => m.mode === mode);
  const signup = mode === "signup";

  return (
    <div className="login">
      <section className={`login-hero ${mode ? "hide-mobile" : ""}`}>
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
          Se paga dentro de las reglas.
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

      {!mode && (
        <div className="login-panel hide-desktop">
          <p className="section-label">¿Cómo entrás?</p>
          {MODES.map((m, i) => (
            <button key={m.mode} type="button" className="role rise" style={{ "--i": i + 2 } as React.CSSProperties} onClick={() => setMode(m.mode)}>
              <span className="role-icon">
                <Icon name={m.icon} size={22} stroke={2} />
              </span>
              <span className="role-text">
                <span className="role-title">{m.title}</span>
                <span className="role-sub">{m.sub}</span>
              </span>
              <Icon name="chev" size={18} stroke={2} className="dim-2" />
            </button>
          ))}
        </div>
      )}

      <div className={`login-right ${mode ? "" : "hide-mobile"}`}>
        <form action={signup ? createAccount : login} className="code-step">
          {!firstOrganizer && (
            <div className="hide-desktop" style={{ paddingTop: 8 }}>
              <button type="button" className="icon-btn" aria-label="Volver" onClick={() => setMode(null)}>
                <Icon name="back" size={22} />
              </button>
            </div>
          )}
          {current && (
            <div className="stack gap-8 hide-desktop" style={{ paddingTop: 32 }}>
              <span className="inline t-green" style={{ fontWeight: 500 }}>
                <Icon name={current.icon} size={16} stroke={2} /> {firstOrganizer ? "Primera vez" : current.sub}
              </span>
              <h1 className="display h1">{firstOrganizer ? "Cuenta del organizador" : current.title}</h1>
            </div>
          )}

          <h1 className="display h1 only-desktop">{firstOrganizer ? "Cuenta del organizador" : signup ? "Crear cuenta" : "Entrar"}</h1>
          {firstOrganizer ? (
            <p className="lead small" style={{ marginTop: 12 }}>
              Todavía no hay nadie. Esta primera cuenta administra el equipo, los presupuestos y los pagos.
            </p>
          ) : (
            <div className="seg only-desktop" role="radiogroup" aria-label="Modo">
              {MODES.map((m) => (
                <button
                  key={m.mode}
                  type="button"
                  role="radio"
                  aria-checked={mode === m.mode}
                  className={`seg-item ${mode === m.mode ? "is-on" : ""}`}
                  onClick={() => setMode(m.mode)}
                >
                  <Icon name={m.icon} size={18} stroke={2} /> {m.title}
                </button>
              ))}
            </div>
          )}

          <div className="stack gap-16" style={{ marginTop: 28 }}>
            {firstOrganizer && (
              <label className="field">
                <span className="field-label">Tu nombre</span>
                <input className="input" name="name" required minLength={2} maxLength={60} autoComplete="name" placeholder="Ej.: Ana Pérez" />
              </label>
            )}
            <label className="field">
              <span className="field-label">Mail</span>
              <input
                className="input"
                type="email"
                name="email"
                required
                defaultValue={email ?? ""}
                autoComplete="email"
                inputMode="email"
                placeholder="vos@equipo.com"
              />
              {signup && !firstOrganizer && <span className="field-help">El mismo con el que te agregó el organizador.</span>}
            </label>
            <label className="field">
              <span className="field-label">{signup ? "Elegí una contraseña" : "Contraseña"}</span>
              <span className="input-wrap">
                <input
                  className={`input ${error ? "is-error" : ""}`}
                  type={show ? "text" : "password"}
                  name="password"
                  required
                  minLength={signup ? 8 : 1}
                  autoComplete={signup ? "new-password" : "current-password"}
                  aria-invalid={!!error}
                />
                <button type="button" className="icon-btn input-suffix" aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"} onClick={() => setShow((v) => !v)}>
                  <Icon name={show ? "eyeOff" : "eye"} size={20} />
                </button>
              </span>
              {signup && <span className="field-help">Al menos 8 caracteres.</span>}
              {error && <span className="field-error">{error}</span>}
            </label>
          </div>
          <div className="push" />
          <SubmitButton pendingText={signup ? "Creando…" : "Entrando…"} disabled={!mode}>
            {signup ? "Crear cuenta" : "Entrar"} <Icon name="arrow" size={18} stroke={2} />
          </SubmitButton>
        </form>
      </div>
    </div>
  );
}
