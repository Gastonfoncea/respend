// Equipo (solo organizador): quién entra, con qué rol y a qué wallet se le paga.
import { requireRole } from "@/lib/session.ts";
import * as server from "@/lib/server.ts";
import * as repo from "@/lib/repo.ts";
import type { MemberRow } from "@/lib/types.ts";
import { addMemberAction, resetAccessAction, setMemberActiveAction, updateMemberAction } from "../actions/team.ts";
import AppShell, { EventHead, ROLE_LABEL } from "../components/AppShell.tsx";
import Flash from "../components/Flash.tsx";
import Icon from "../components/Icon.tsx";
import Sheet from "../components/Sheet.tsx";
import SubmitButton from "../components/SubmitButton.tsx";
import { Row, Rows, SectionLabel, shortAddr } from "../components/ui.tsx";

export const dynamic = "force-dynamic";

const WALLET_PATTERN = "^\\s*0x[0-9a-fA-F]{40}\\s*$";

function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function MemberFields({ m }: { m?: MemberRow }) {
  return (
    <>
      <label className="field">
        <span className="field-label">Nombre</span>
        <input className="input" name="name" required minLength={2} maxLength={60} defaultValue={m?.name ?? ""} autoComplete="off" />
      </label>
      {!m && (
        <label className="field">
          <span className="field-label">Mail</span>
          <input className="input" type="email" name="email" required autoComplete="off" placeholder="persona@equipo.com" />
          <span className="field-help">Con este mail crea su contraseña la primera vez.</span>
        </label>
      )}
      <label className="field">
        <span className="field-label">Rol</span>
        <select className="input" name="role" defaultValue={m?.role ?? "collaborator"}>
          <option value="collaborator">Colaborador: presenta gastos</option>
          <option value="organizer">Organizador: revisa, paga y administra</option>
        </select>
      </label>
      <label className="field">
        <span className="field-label">Wallet de cobro</span>
        <input
          className="input mono"
          name="wallet"
          pattern={WALLET_PATTERN}
          defaultValue={m?.wallet ?? ""}
          placeholder="0x…"
          spellCheck={false}
          autoComplete="off"
        />
        <span className="field-help">A esta dirección se le pagan los reembolsos en Celo. Los gastos ya presentados conservan la de antes.</span>
      </label>
    </>
  );
}

export default async function EquipoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireRole(["organizer"]);
  const sp = await searchParams;
  const db = await server.db();
  const cfg = server.config();
  const policy = await repo.getPolicy(db);
  const members = await repo.listMembers(db);
  const pending = members.filter((m) => m.active && !m.auth_user_id).length;

  const add = (
    <Sheet triggerClassName="btn-link" trigger="Agregar">
      <h2 className="display h2">Agregar al equipo</h2>
      <form action={addMemberAction} className="stack gap-16">
        <MemberFields />
        <SubmitButton pendingText="Agregando…">Agregar</SubmitButton>
      </form>
    </Sheet>
  );

  return (
    <AppShell mode={cfg.paymentMode} role={session.role} eventName={policy.name}>
      <Flash error={sp.error} ok={sp.ok} />
      <EventHead eventName={policy.name} mode={cfg.paymentMode} role={session.role} />
      <div className="page">
        <section className="rise" style={{ paddingTop: 20 }}>
          <p className="label">Equipo</p>
          <h1 className="display fund-state">
            {members.length} {members.length === 1 ? "persona" : "personas"}
          </h1>
          {pending > 0 && (
            <p className="small dim">
              {pending} {pending === 1 ? "todavía no creó" : "todavía no crearon"} su contraseña. Pasales la URL de la app: entran con
              &quot;Crear cuenta&quot; y su mail.
            </p>
          )}
        </section>

        <section className="rise" style={{ marginTop: 32, "--i": 2 } as React.CSSProperties}>
          <SectionLabel action={add}>Personas</SectionLabel>
          <div className="list">
            {members.map((m) => {
              const self = m.id === session.memberId;
              const status = !m.active ? "Sin acceso" : m.auth_user_id ? "Con cuenta" : "Falta crear la cuenta";
              return (
                <Sheet
                  key={m.id}
                  triggerClassName={`item row-btn ${m.active ? "" : "is-muted"}`}
                  trigger={
                    <>
                      <span className="avatar">{initials(m.name)}</span>
                      <span className="item-main">
                        <span className="item-title">
                          {m.name}
                          {self ? " (vos)" : ""}
                        </span>
                        <span className="item-sub">
                          {ROLE_LABEL[m.role]} · {m.wallet ? <span className="mono">{shortAddr(m.wallet)}</span> : "sin wallet"}
                        </span>
                      </span>
                      <span className="item-end">
                        <span className={`item-status ${!m.active ? "t-red" : m.auth_user_id ? "t-green" : "t-amb"}`}>{status}</span>
                      </span>
                      <Icon name="chev" size={18} stroke={2} className="dim-2 chev" />
                    </>
                  }
                >
                  <h2 className="display h2">{m.name}</h2>
                  <Rows>
                    <Row k="Mail">{m.email}</Row>
                    <Row k="Acceso" tone={!m.active ? "red" : m.auth_user_id ? "green" : "amb"}>
                      {status}
                    </Row>
                  </Rows>
                  <form action={updateMemberAction} className="stack gap-16">
                    <input type="hidden" name="memberId" value={m.id} />
                    <MemberFields m={m} />
                    <SubmitButton pendingText="Guardando…">Guardar cambios</SubmitButton>
                  </form>
                  {!self && (
                    <div className="btn-row" style={{ marginTop: 16 }}>
                      <form action={setMemberActiveAction}>
                        <input type="hidden" name="memberId" value={m.id} />
                        <input type="hidden" name="active" value={m.active ? "0" : "1"} />
                        <SubmitButton className={`btn btn-sm ${m.active ? "btn-danger" : ""}`} pendingText="…">
                          {m.active ? "Quitar acceso" : "Devolver acceso"}
                        </SubmitButton>
                      </form>
                      {m.auth_user_id && (
                        <form action={resetAccessAction}>
                          <input type="hidden" name="memberId" value={m.id} />
                          <SubmitButton className="btn btn-sm" pendingText="…">
                            Reiniciar contraseña
                          </SubmitButton>
                        </form>
                      )}
                    </div>
                  )}
                </Sheet>
              );
            })}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
