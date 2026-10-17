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
  const db = server.db();
  const cfg = server.config();
  const policy = repo.getPolicy(db);
  const limit = repo.getAutoPayLimitCents(db);
  const on = limit > 0;
  const paid = repo.autoPaidTotals(db);

  const edit = (
    <Sheet triggerClassName="btn-link" trigger="Editar">
      <h2 className="display h2">Pago automático</h2>
      <form action={setAutoPayLimitAction} className="stack gap-16">
        <label className="field">
          <span className="field-label">Límite</span>
          <input className="input mono" name="limit" inputMode="decimal" defaultValue={centsToDecimalString(limit)} autoComplete="off" />
          <span className="field-help">0 para apagarlo. Máximo {shortArs(policy.capPerReceiptCents)}.</span>
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
            <Row k="Condición">Sin alertas</Row>
            <Row k="Pagados solos">
              {paid.count} · {shortArs(paid.cents)}
            </Row>
          </Rows>
        </section>
      </div>
    </AppShell>
  );
}
