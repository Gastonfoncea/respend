// Configuración del agente (solo organizador). Por ahora: pago automático.
import { requireRole } from "@/lib/session.ts";
import * as server from "@/lib/server.ts";
import * as repo from "@/lib/repo.ts";
import { centsToDecimalString } from "@/lib/money.ts";
import { setAutoPayLimitAction } from "../actions/requests.ts";
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
  const limit = await repo.getAutoPayLimitCents(db);
  const on = limit > 0;
  const paid = await repo.autoPaidTotals(db);
  const cap = await repo.getAutoPayDailyCap(db);
  const used24h = await repo.autoAuthorizedSinceCents(db, new Date(Date.now() - 24 * 3600 * 1000).toISOString());

  const edit = (
    <Sheet triggerClassName="btn-link" trigger="Editar">
      <h2 className="display h2">Pago automático</h2>
      <form action={setAutoPayLimitAction} className="stack gap-16">
        <label className="field">
          <span className="field-label">Límite</span>
          <input className="input mono" name="limit" inputMode="decimal" defaultValue={centsToDecimalString(limit)} autoComplete="off" />
          <span className="field-help">Por gasto. 0 para apagarlo. Máximo {shortArs(policy.capPerReceiptCents)}.</span>
        </label>
        <label className="field">
          <span className="field-label">Tope en 24 h</span>
          <input
            className="input mono"
            name="dailyCap"
            inputMode="decimal"
            defaultValue={cap.custom ? centsToDecimalString(cap.cents) : ""}
            placeholder={`Automático: ${centsToDecimalString(cap.cents)}`}
            autoComplete="off"
          />
          <span className="field-help">Cuánto puede pagar solo en total en 24 h. Vacío = 3 veces el límite. Lo que pase el tope va a vos.</span>
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
          <h1 className={`display fund-state ${on ? "t-green" : "dim"}`}>{on ? `Paga solo hasta ${shortArs(limit)}` : "Pago automático apagado"}</h1>
        </section>

        <section className="rise" style={{ marginTop: 32, "--i": 2 } as React.CSSProperties}>
          <SectionLabel action={edit}>Pago automático</SectionLabel>
          <Rows>
            <Row k="Límite">{on ? shortArs(limit) : "Apagado"}</Row>
            <Row k="Tope en 24 h">
              {on ? `${shortArs(cap.cents)}${cap.custom ? "" : " (automático)"}` : "—"}
            </Row>
            <Row k="Usado en 24 h">{shortArs(used24h)}</Row>
            <Row k="Condición">Sin alertas y sin intervención tuya</Row>
            <Row k="Pagados solos">
              {paid.count} · {shortArs(paid.cents)}
            </Row>
          </Rows>
        </section>
      </div>
    </AppShell>
  );
}
