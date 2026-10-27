// Presupuestos (solo organizador): cada uno es un evento con nombre y fechas. Abajo, las categorías.
import Link from "next/link";
import { requireRole } from "@/lib/session.ts";
import * as server from "@/lib/server.ts";
import * as repo from "@/lib/repo.ts";
import * as budgets from "@/lib/budgets.ts";
import { createBudgetAction, saveCategoryAction } from "../actions/budgets.ts";
import AppShell, { EventHead } from "../components/AppShell.tsx";
import Flash from "../components/Flash.tsx";
import Icon from "../components/Icon.tsx";
import Sheet from "../components/Sheet.tsx";
import SubmitButton from "../components/SubmitButton.tsx";
import { SectionLabel, shortArs } from "../components/ui.tsx";
import type { CategoryRow } from "@/lib/types.ts";

export const dynamic = "force-dynamic";

function CategoryForm({ c }: { c?: CategoryRow }) {
  return (
    <form action={saveCategoryAction} className="stack gap-16">
      {c ? (
        <input type="hidden" name="key" value={c.key} />
      ) : (
        <label className="field">
          <span className="field-label">Clave</span>
          <input className="input mono" name="key" required pattern="[a-z_]{2,30}" placeholder="catering" autoComplete="off" />
          <span className="field-help">Minúsculas y guion bajo. No se puede cambiar después.</span>
        </label>
      )}
      <label className="field">
        <span className="field-label">Nombre</span>
        <input className="input" name="name" required minLength={2} maxLength={40} defaultValue={c?.name ?? ""} />
      </label>
      <label className="field">
        <span className="field-label">Qué entra</span>
        <input className="input" name="description" maxLength={300} defaultValue={c?.description ?? ""} placeholder="Ej.: comida y bebida para los asistentes" />
        <span className="field-help">El agente lo usa para clasificar los tickets.</span>
      </label>
      <label className="field">
        <span className="field-label">Estado</span>
        <select className="input" name="active" defaultValue={c && !c.active ? "0" : "1"}>
          <option value="1">Activa</option>
          <option value="0">Inactiva (el agente no la ofrece)</option>
        </select>
      </label>
      <SubmitButton pendingText="Guardando…">{c ? "Guardar" : "Crear categoría"}</SubmitButton>
    </form>
  );
}

export default async function PresupuestosPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireRole(["organizer"]);
  const sp = await searchParams;
  const db = await server.db();
  const cfg = server.config();
  const policy = await repo.getPolicy(db);
  const list = await budgets.listBudgets(db);
  const categories = await budgets.listCategories(db);
  const usage = new Map(
    await Promise.all(
      list.map(async (b) => {
        const as = await budgets.listAssignments(db, b.id);
        const bal = await Promise.all(as.map((a) => budgets.balanceOf(db, a)));
        return [b.id, { assigned: as.reduce((x, a) => x + a.amount_cents, 0), used: bal.reduce((x, y) => x + y.consumedCents, 0), people: new Set(as.map((a) => a.member_id)).size }] as const;
      }),
    ),
  );
  const today = new Date().toISOString().slice(0, 10);

  const create = (
    <Sheet triggerClassName="btn-link" trigger="Nuevo">
      <h2 className="display h2">Nuevo presupuesto</h2>
      <form action={createBudgetAction} className="stack gap-16">
        <label className="field">
          <span className="field-label">Nombre</span>
          <input className="input" name="name" required minLength={2} maxLength={80} placeholder="Meetup 25/10 u Octubre 2026" />
        </label>
        <div className="grid-2">
          <label className="field">
            <span className="field-label">Desde</span>
            <input className="input" type="date" name="startsOn" defaultValue={today} required />
          </label>
          <label className="field">
            <span className="field-label">Hasta</span>
            <input className="input" type="date" name="endsOn" defaultValue={today} required />
          </label>
        </div>
        <label className="field">
          <span className="field-label">Pago automático hasta (por ticket)</span>
          <input className="input mono" name="autopayMax" inputMode="decimal" placeholder="0 = todo lo aprobás vos" autoComplete="off" />
          <span className="field-help">Arriba de este monto requiere tu aprobación aunque entre en el saldo. Máximo {shortArs(policy.capPerReceiptCents)}.</span>
        </label>
        <SubmitButton pendingText="Creando…">Crear</SubmitButton>
      </form>
    </Sheet>
  );

  return (
    <AppShell mode={cfg.paymentMode} role={session.role} eventName={policy.name}>
      <Flash error={sp.error} ok={sp.ok} />
      <EventHead eventName={policy.name} mode={cfg.paymentMode} role={session.role} />
      <div className="page">
        <section className="rise" style={{ paddingTop: 20 }}>
          <p className="label">Presupuestos</p>
          <h1 className="display fund-state">
            {list.filter((b) => b.status === "open").length} {list.filter((b) => b.status === "open").length === 1 ? "abierto" : "abiertos"}
          </h1>
          <p className="small dim">
            Asignale a cada persona cuánto puede gastar: esa asignación es tu aprobación. Lo que entra se paga solo; lo que no, te llega a vos.{" "}
            <Link href="/evento/politica" className="t-green">
              Política general
            </Link>
          </p>
        </section>

        <section className="rise" style={{ marginTop: 32, "--i": 2 } as React.CSSProperties}>
          <SectionLabel action={create}>Presupuestos</SectionLabel>
          {list.length === 0 ? (
            <p className="small dim">Todavía no hay presupuestos. Creá uno para empezar a asignar.</p>
          ) : (
            <div className="list">
              {list.map((b) => {
                const u = usage.get(b.id)!;
                return (
                  <Link key={b.id} href={`/presupuestos/${b.id}`} className={`item ${b.status === "closed" ? "is-muted" : ""}`}>
                    <span className="avatar">
                      <Icon name="sliders" size={20} />
                    </span>
                    <span className="item-main">
                      <span className="item-title">{b.name}</span>
                      <span className="item-sub">
                        {b.starts_on} a {b.ends_on} · {u.people} {u.people === 1 ? "persona" : "personas"}
                      </span>
                    </span>
                    <span className="item-end">
                      <span className="item-amount">{shortArs(u.assigned)}</span>
                      <span className={`item-status ${b.status === "open" ? "t-green" : "dim"}`}>
                        {b.status === "open" ? `Usado ${shortArs(u.used)}` : "Cerrado"}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        <section className="rise" style={{ marginTop: 32, "--i": 3 } as React.CSSProperties}>
          <SectionLabel
            action={
              <Sheet triggerClassName="btn-link" trigger="Nueva">
                <h2 className="display h2">Nueva categoría</h2>
                <CategoryForm />
              </Sheet>
            }
          >
            Categorías
          </SectionLabel>
          <div className="list">
            {categories.map((c) => (
              <Sheet
                key={c.key}
                triggerClassName={`item row-btn ${c.active ? "" : "is-muted"}`}
                trigger={
                  <>
                    <span className="item-main">
                      <span className="item-title">{c.name}</span>
                      <span className="item-sub">{c.description || c.key}</span>
                    </span>
                    <span className={`item-status ${c.active ? "t-green" : "dim"}`}>{c.active ? "Activa" : "Inactiva"}</span>
                  </>
                }
              >
                <h2 className="display h2">{c.name}</h2>
                <CategoryForm c={c} />
              </Sheet>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
