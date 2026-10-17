import Link from "next/link";
import { requireRole } from "@/lib/session.ts";
import * as server from "@/lib/server.ts";
import * as repo from "@/lib/repo.ts";
import { getBudget } from "@/lib/budget.ts";
import { centsToDecimalString } from "@/lib/money.ts";
import { KNOWN_CATEGORIES } from "@/lib/workflow.ts";
import { updatePolicyAction } from "../../actions/requests.ts";
import AppShell, { EventHead } from "../../components/AppShell.tsx";
import CategoryOptions from "../../components/CategoryOptions.tsx";
import Flash from "../../components/Flash.tsx";
import Icon from "../../components/Icon.tsx";
import Sheet from "../../components/Sheet.tsx";
import SubmitButton from "../../components/SubmitButton.tsx";
import { Amount, Row, Rows, SectionLabel, Ticks, kArs, shortArs } from "../../components/ui.tsx";

export const dynamic = "force-dynamic";

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const mi = Number(m) - 1;
  return months[mi] ? `${Number(d)} ${months[mi]} ${y}` : iso;
}

export default async function PoliticaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireRole();
  const sp = await searchParams;
  const db = server.db();
  const cfg = server.config();
  const policy = repo.getPolicy(db);
  const budget = getBudget(db);
  const count = repo.countRequests(db);
  const locked = count > 0;
  const isOrg = session.role === "organizer";
  const live = budget.committedCents - budget.paidCents;

  const editAction = !isOrg ? null : locked ? (
    <Sheet triggerClassName="btn-link inline" trigger={<><Icon name="lock" size={14} stroke={2} /> Bloqueada</>}>
      <div className="state-badge" style={{ background: "var(--s2)", width: 48, height: 48, borderRadius: 15 }}>
        <Icon name="lock" size={22} stroke={2} />
      </div>
      <h2 className="display h2">La política está bloqueada</h2>
      <p className="lead">
        Ya hay {count} {count === 1 ? "solicitud evaluada" : "solicitudes evaluadas"} con estas reglas. Cambiarlas ahora alteraría esas
        decisiones.
      </p>
    </Sheet>
  ) : (
    <Sheet triggerClassName="btn-link" trigger="Editar">
      <h2 className="display h2">Política</h2>
      <form action={updatePolicyAction} className="stack gap-16">
        <label className="field">
          <span className="field-label">Evento</span>
          <input className="input" name="name" defaultValue={policy.name} required />
        </label>
        <div className="grid-2">
          <label className="field">
            <span className="field-label">Desde</span>
            <input className="input" type="date" name="startDate" defaultValue={policy.startDate} required />
          </label>
          <label className="field">
            <span className="field-label">Hasta</span>
            <input className="input" type="date" name="endDate" defaultValue={policy.endDate} required />
          </label>
        </div>
        <div className="grid-2">
          <label className="field">
            <span className="field-label">Tope por ticket</span>
            <input className="input" name="cap" inputMode="decimal" defaultValue={centsToDecimalString(policy.capPerReceiptCents)} required />
          </label>
          <label className="field">
            <span className="field-label">Presupuesto</span>
            <input className="input" name="budget" inputMode="decimal" defaultValue={centsToDecimalString(policy.budgetCents)} required />
          </label>
        </div>
        <CategoryOptions known={KNOWN_CATEGORIES} selected={policy.categories} />
        <SubmitButton pendingText="Guardando…">Guardar política</SubmitButton>
      </form>
    </Sheet>
  );

  return (
    <AppShell mode={cfg.paymentMode} role={session.role} eventName={policy.name}>
      <Flash error={sp.error} ok={sp.ok} />
      <EventHead eventName={policy.name} mode={cfg.paymentMode} role={session.role} />
      <div className="page">
        <section className="stack gap-4 rise" style={{ paddingTop: 20 }}>
          <p className="label">Presupuesto del evento</p>
          <Amount cents={budget.totalCents} size="md" />
          <div className="sp-16" />
          <Ticks
            total={budget.totalCents}
            segments={[
              { cents: budget.paidCents, kind: "paid" },
              { cents: live, kind: "live" },
            ]}
          />
          <div className="ticks-legend mono">
            <span className="dim">Pagado {kArs(budget.paidCents)}</span>
            <span className="t-green">En curso {kArs(live)}</span>
            <span className="dim-2">Libre {kArs(budget.availableCents)}</span>
          </div>
          <p className="field-help" style={{ marginTop: 10 }}>
            Es el tope que fijaste. La plata real está en <Link href="/wallet" className="t-green">Wallet</Link>.
          </p>
        </section>

        <section className="rise" style={{ marginTop: 32, "--i": 2 } as React.CSSProperties}>
          <SectionLabel action={editAction}>Política v{policy.version}</SectionLabel>
          <Rows>
            <Row k="Fechas">
              {fmtDate(policy.startDate)} – {fmtDate(policy.endDate)}
            </Row>
            <Row k="Tope por ticket">{shortArs(policy.capPerReceiptCents)}</Row>
            <Row k="Categorías">
              <span style={{ textTransform: "capitalize" }}>{policy.categories.join(", ")}</span>
            </Row>
            <Row k="Moneda">ARS → wARS</Row>
          </Rows>
          <p className="field-help" style={{ marginTop: 12 }}>
            wARS es un token de Ripio que representa pesos argentinos en la red Celo. 1 wARS = 1 peso.
          </p>
        </section>
      </div>
    </AppShell>
  );
}
