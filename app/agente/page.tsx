// Configuración del agente (solo organizador): cómo decide el pago automático y su tope de 24 h.
// El máximo por ticket es de cada presupuesto (Presupuestos); acá queda el freno global del agente.
import Link from "next/link";
import { requireRole } from "@/lib/session.ts";
import * as server from "@/lib/server.ts";
import * as repo from "@/lib/repo.ts";
import * as budgets from "@/lib/budgets.ts";
import { centsToDecimalString } from "@/lib/money.ts";
import { setAutoPayCapAction } from "../actions/requests.ts";
import AppShell, { EventHead } from "../components/AppShell.tsx";
import Flash from "../components/Flash.tsx";
import Sheet from "../components/Sheet.tsx";
import SubmitButton from "../components/SubmitButton.tsx";
import { Row, Rows, SectionLabel, shortArs } from "../components/ui.tsx";

export const dynamic = "force-dynamic";

export default async function AgentePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireRole(["organizer"]);
  const sp = await searchParams;
  const db = await server.db();
  const cfg = server.config();
  const policy = await repo.getPolicy(db);
  const open = (await budgets.listBudgets(db)).filter((b) => b.status === "open");
  const withAuto = open.filter((b) => b.autopay_max_per_receipt_cents > 0);
  const paid = await repo.autoPaidTotals(db);
  const custom = await repo.getCustomDailyCapCents(db);
  const used24h = await repo.autoAuthorizedSinceCents(db, new Date(Date.now() - 24 * 3600 * 1000).toISOString());
  const on = withAuto.length > 0;

  const edit = (
    <Sheet triggerClassName="btn-link" trigger="Editar">
      <h2 className="display h2">Tope en 24 h</h2>
      <form action={setAutoPayCapAction} className="stack gap-16">
        <label className="field">
          <span className="field-label">Tope en 24 h</span>
          <input
            className="input mono"
            name="dailyCap"
            inputMode="decimal"
            defaultValue={custom != null ? centsToDecimalString(custom) : ""}
            placeholder="Automático: 3 veces el máximo por ticket"
            autoComplete="off"
          />
          <span className="field-help">
            Cuánto puede pagar solo el agente en total en 24 h, sumando todos los presupuestos. Vacío = 3 veces el máximo por ticket del
            presupuesto de cada gasto. Lo que pase el tope te llega a vos.
          </span>
        </label>
        <SubmitButton pendingText="Guardando…">Guardar</SubmitButton>
      </form>
    </Sheet>
  );

  return (
    <AppShell mode={cfg.paymentMode} role={session.role} eventName={policy.name}>
      <Flash error={sp.error} ok={sp.ok} />
      <EventHead eventName={policy.name} mode={cfg.paymentMode} role={session.role} />
      <div className="page">
        <section className="rise" style={{ paddingTop: 20 }}>
          <p className="label">Agente</p>
          <h1 className={`display fund-state ${on ? "t-green" : "dim"}`}>{on ? "Paga solo dentro de lo asignado" : "Pago automático apagado"}</h1>
          <p className="small dim">
            Cada asignación es tu aprobación por adelantado. Un ticket se paga solo si no tiene alertas, nadie intervino, el presupuesto está
            abierto y es de esas fechas, entra en el saldo de la persona, no supera el máximo por ticket y entra en el tope de 24 h. Si no,
            te llega a vos.
          </p>
        </section>

        <section className="rise" style={{ marginTop: 32, "--i": 2 } as React.CSSProperties}>
          <SectionLabel action={<Link href="/presupuestos" className="btn-link">Presupuestos</Link>}>Máximo por ticket</SectionLabel>
          <Rows>
            {open.length === 0 && <Row k="Presupuestos abiertos">Ninguno</Row>}
            {open.map((b) => (
              <Row key={b.id} k={b.name}>
                {b.autopay_max_per_receipt_cents > 0 ? shortArs(b.autopay_max_per_receipt_cents) : "Sin pago automático"}
              </Row>
            ))}
          </Rows>
        </section>

        <section className="rise" style={{ marginTop: 32, "--i": 3 } as React.CSSProperties}>
          <SectionLabel action={edit}>Freno del agente</SectionLabel>
          <Rows>
            <Row k="Tope en 24 h">{custom != null ? shortArs(custom) : "Automático (3× el máximo por ticket)"}</Row>
            <Row k="Usado en 24 h">{shortArs(used24h)}</Row>
            <Row k="Pagados solos">
              {paid.count} · {shortArs(paid.cents)}
            </Row>
          </Rows>
        </section>
      </div>
    </AppShell>
  );
}
