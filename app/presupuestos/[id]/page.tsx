// Un presupuesto (solo organizador): datos, cierre y asignaciones por persona y categoría con su uso.
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/session.ts";
import * as server from "@/lib/server.ts";
import * as repo from "@/lib/repo.ts";
import * as budgets from "@/lib/budgets.ts";
import { centsToDecimalString } from "@/lib/money.ts";
import { setAssignmentAction, updateBudgetAction } from "../../actions/budgets.ts";
import AppShell from "../../components/AppShell.tsx";
import Flash from "../../components/Flash.tsx";
import Sheet from "../../components/Sheet.tsx";
import SubmitButton from "../../components/SubmitButton.tsx";
import { Row, Rows, SectionLabel, Ticks, TopBar, shortArs } from "../../components/ui.tsx";
import type { BudgetRow, CategoryRow, MemberRow } from "@/lib/types.ts";

export const dynamic = "force-dynamic";

function AssignmentForm({
  budgetId,
  members,
  categories,
  memberId,
  categoryKey,
  amountCents,
}: {
  budgetId: number;
  members: MemberRow[];
  categories: CategoryRow[];
  memberId?: number;
  categoryKey?: string | null;
  amountCents?: number;
}) {
  const editing = memberId != null;
  return (
    <form action={setAssignmentAction} className="stack gap-16">
      <input type="hidden" name="budgetId" value={budgetId} />
      {editing ? (
        <>
          <input type="hidden" name="memberId" value={memberId} />
          <input type="hidden" name="categoryKey" value={categoryKey ?? ""} />
        </>
      ) : (
        <>
          <label className="field">
            <span className="field-label">Persona</span>
            <select className="input" name="memberId" required>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.wallet ? "" : " (sin wallet)"}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Categoría</span>
            <select className="input" name="categoryKey" defaultValue="">
              <option value="">Cualquier categoría</option>
              {categories.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      <label className="field">
        <span className="field-label">Monto</span>
        <input
          className="input mono"
          name="amount"
          inputMode="decimal"
          required
          defaultValue={amountCents != null ? centsToDecimalString(amountCents) : ""}
          placeholder="80000"
          autoComplete="off"
        />
        <span className="field-help">Bajarlo no revoca lo ya autorizado. 0 deja la asignación sin saldo.</span>
      </label>
      <SubmitButton pendingText="Guardando…">{editing ? "Guardar" : "Asignar"}</SubmitButton>
    </form>
  );
}

function BudgetForm({ b, capCents }: { b: BudgetRow; capCents: number }) {
  return (
    <form action={updateBudgetAction} className="stack gap-16">
      <input type="hidden" name="budgetId" value={b.id} />
      <label className="field">
        <span className="field-label">Nombre</span>
        <input className="input" name="name" required minLength={2} maxLength={80} defaultValue={b.name} />
      </label>
      <div className="grid-2">
        <label className="field">
          <span className="field-label">Desde</span>
          <input className="input" type="date" name="startsOn" defaultValue={b.starts_on} required />
        </label>
        <label className="field">
          <span className="field-label">Hasta</span>
          <input className="input" type="date" name="endsOn" defaultValue={b.ends_on} required />
        </label>
      </div>
      <label className="field">
        <span className="field-label">Pago automático hasta (por ticket)</span>
        <input className="input mono" name="autopayMax" inputMode="decimal" defaultValue={centsToDecimalString(b.autopay_max_per_receipt_cents)} />
        <span className="field-help">0 = todo lo aprobás vos. Máximo {shortArs(capCents)}.</span>
      </label>
      <label className="field">
        <span className="field-label">Estado</span>
        <select className="input" name="status" defaultValue={b.status}>
          <option value="open">Abierto</option>
          <option value="closed">Cerrado (no se paga nada solo)</option>
        </select>
      </label>
      <SubmitButton pendingText="Guardando…">Guardar</SubmitButton>
    </form>
  );
}

export default async function PresupuestoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireRole(["organizer"]);
  const sp = await searchParams;
  const id = Number.parseInt((await params).id, 10);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();
  const db = await server.db();
  const cfg = server.config();
  const policy = await repo.getPolicy(db);
  const b = await budgets.getBudgetById(db, id);
  if (!b) notFound();
  const members = (await repo.listMembers(db)).filter((m) => m.active && m.role === "collaborator");
  const byId = new Map((await repo.listMembers(db)).map((m) => [m.id, m]));
  const categories = await budgets.listCategories(db, true);
  const catName = new Map((await budgets.listCategories(db)).map((c) => [c.key, c.name]));
  const balances = await Promise.all((await budgets.listAssignments(db, id)).map((a) => budgets.balanceOf(db, a)));
  const assigned = balances.reduce((x, y) => x + y.assignment.amount_cents, 0);
  const used = balances.reduce((x, y) => x + y.consumedCents, 0);

  return (
    <AppShell mode={cfg.paymentMode} role={session.role} eventName={policy.name}>
      <Flash error={sp.error} ok={sp.ok} />
      <TopBar title={b.name} back="/presupuestos" mode={cfg.paymentMode} />
      <div className="page">
        <section className="rise" style={{ paddingTop: 20 }}>
          <p className="label">{b.status === "open" ? "Abierto" : "Cerrado"}</p>
          <h1 className="display fund-state">{shortArs(assigned)} asignados</h1>
          <div className="sp-16" />
          <Ticks total={Math.max(assigned, 1)} segments={[{ cents: used, kind: "live" }]} />
          <div className="ticks-legend mono">
            <span className="t-green">Usado {shortArs(used)}</span>
            <span className="dim">Libre {shortArs(Math.max(assigned - used, 0))}</span>
          </div>
        </section>

        <section className="rise" style={{ marginTop: 32, "--i": 2 } as React.CSSProperties}>
          <SectionLabel
            action={
              <Sheet triggerClassName="btn-link" trigger="Editar">
                <h2 className="display h2">{b.name}</h2>
                <BudgetForm b={b} capCents={policy.capPerReceiptCents} />
              </Sheet>
            }
          >
            Reglas
          </SectionLabel>
          <Rows>
            <Row k="Fechas">
              {b.starts_on} a {b.ends_on}
            </Row>
            <Row k="Pago automático hasta">{b.autopay_max_per_receipt_cents > 0 ? `${shortArs(b.autopay_max_per_receipt_cents)} por ticket` : "Apagado"}</Row>
          </Rows>
        </section>

        <section className="rise" style={{ marginTop: 32, "--i": 3 } as React.CSSProperties}>
          <SectionLabel
            action={
              members.length ? (
                <Sheet triggerClassName="btn-link" trigger="Asignar">
                  <h2 className="display h2">Asignar presupuesto</h2>
                  <AssignmentForm budgetId={b.id} members={members} categories={categories} />
                </Sheet>
              ) : undefined
            }
          >
            Asignaciones
          </SectionLabel>
          {!members.length && <p className="small dim">Primero agregá colaboradores en Equipo.</p>}
          {balances.length === 0 && members.length > 0 && <p className="small dim">Todavía no asignaste nada en este presupuesto.</p>}
          <div className="list">
            {balances.map((x) => {
              const m = byId.get(x.assignment.member_id);
              return (
                <Sheet
                  key={x.assignment.id}
                  triggerClassName="item row-btn"
                  trigger={
                    <>
                      <span className="item-main">
                        <span className="item-title">{m?.name ?? `#${x.assignment.member_id}`}</span>
                        <span className="item-sub">
                          {x.assignment.category_key ? (catName.get(x.assignment.category_key) ?? x.assignment.category_key) : "Cualquier categoría"}
                        </span>
                      </span>
                      <span className="item-end">
                        <span className="item-amount">{shortArs(x.availableCents)}</span>
                        <span className="item-status dim">de {shortArs(x.assignment.amount_cents)}</span>
                      </span>
                    </>
                  }
                >
                  <h2 className="display h2">{m?.name}</h2>
                  <Rows>
                    <Row k="Asignado">{shortArs(x.assignment.amount_cents)}</Row>
                    <Row k="Consumido">{shortArs(x.consumedCents)}</Row>
                    <Row k="Disponible">{shortArs(x.availableCents)}</Row>
                  </Rows>
                  <AssignmentForm
                    budgetId={b.id}
                    members={members}
                    categories={categories}
                    memberId={x.assignment.member_id}
                    categoryKey={x.assignment.category_key}
                    amountCents={x.assignment.amount_cents}
                  />
                </Sheet>
              );
            })}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
