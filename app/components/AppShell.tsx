// Estructura de las páginas con sesión: barra lateral en desktop, pestañas abajo en mobile.
import Link from "next/link";
import type { PaymentMode } from "@/lib/config.ts";
import type { Role } from "@/lib/types.ts";
import { logout } from "../actions/session.ts";
import Icon from "./Icon.tsx";
import NavLinks from "./NavLinks.tsx";
import Sheet from "./Sheet.tsx";
import SubmitButton from "./SubmitButton.tsx";
import { ModeTag, Row, Rows } from "./ui.tsx";

export const ROLE_LABEL: Record<Role, string> = { organizer: "Organizador", collaborator: "Colaborador" };

export default function AppShell({
  children,
  mode,
  role,
  eventName,
  tabs = true,
}: {
  children: React.ReactNode;
  mode: PaymentMode;
  role: Role;
  eventName: string;
  tabs?: boolean;
}) {
  return (
    <div className="shell">
      <aside className="side">
        <div className="side-brand">
          <Link href="/evento" className="brand">
            respend
          </Link>
          <ModeTag mode={mode} />
        </div>
        <NavLinks variant="side" role={role} />
        <div className="side-foot">
          <AccountSheet role={role} mode={mode} eventName={eventName} variant="side" />
        </div>
      </aside>
      <div className={`main ${tabs ? "" : "no-tabs"}`}>{children}</div>
      {tabs && (
        <nav className="tabbar" aria-label="Secciones">
          <NavLinks variant="tab" role={role} />
        </nav>
      )}
    </div>
  );
}

/** Cabecera de las pantallas principales: nombre del evento, modo y cuenta. */
export function EventHead({ eventName, mode, role }: { eventName: string; mode: PaymentMode; role: Role }) {
  return (
    <header className="event-head">
      <span>{eventName}</span>
      <span className="inline" style={{ gap: 14 }}>
        <ModeTag mode={mode} />
        <span className="hide-desktop">
          <AccountSheet role={role} mode={mode} eventName={eventName} variant="icon" />
        </span>
      </span>
    </header>
  );
}

export function AccountSheet({ role, mode, eventName, variant }: { role: Role; mode: PaymentMode; eventName: string; variant: "icon" | "side" }) {
  return (
    <Sheet
      triggerClassName={variant === "icon" ? "icon-btn" : "side-link"}
      triggerLabel="Tu sesión"
      trigger={
        variant === "icon" ? (
          <Icon name="user" size={20} />
        ) : (
          <>
            <Icon name="user" size={18} />
            <span>{ROLE_LABEL[role]}</span>
          </>
        )
      }
    >
      <p className="label">Entraste como</p>
      <h2 className="display h1">{ROLE_LABEL[role]}</h2>
      <Rows>
        <Row k="Evento">{eventName}</Row>
        <Row k="Modo" tone={mode === "mainnet" ? undefined : "amb"}>
          {mode === "mainnet" ? "Mainnet real" : "Simulado"}
        </Row>
      </Rows>
      <form action={logout}>
        <SubmitButton className="btn btn-danger" pendingText="Saliendo…">
          <Icon name="out" size={18} stroke={2} /> Cerrar sesión
        </SubmitButton>
      </form>
    </Sheet>
  );
}
