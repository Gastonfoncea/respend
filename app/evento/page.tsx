import Link from "next/link";
import { requireRole } from "@/lib/session.ts";
import * as server from "@/lib/server.ts";
import * as repo from "@/lib/repo.ts";
import { getBudget } from "@/lib/budget.ts";
import { centsToWei } from "@/lib/money.ts";
import { getAgentAddress } from "@/lib/chain/signer.ts";
import type { RequestRow, RequestStatus } from "@/lib/types.ts";
import AppShell, { EventHead } from "../components/AppShell.tsx";
import Flash from "../components/Flash.tsx";
import Icon from "../components/Icon.tsx";
import { collabStatus, orgStatus, type StatusView } from "../components/labels.ts";
import { Amount, SectionLabel, Ticks, kArs, shortArs, toneClass } from "../components/ui.tsx";
import { MIN_CELO_WEI, walletInfo } from "../components/wallet.ts";

export const dynamic = "force-dynamic";

const ORG_GROUPS: { title: string; statuses: RequestStatus[] }[] = [
  { title: "Para revisar", statuses: ["analyzed"] },
  { title: "Pagos", statuses: ["authorized", "paying", "payment_failed", "payment_uncertain"] },
  { title: "Esperando info", statuses: ["needs_info", "submitted"] },
  { title: "Cerradas", statuses: ["reimbursed", "rejected"] },
];

function Item({ r, view, i, showClaimant = false }: { r: RequestRow; view: StatusView; i: number; showClaimant?: boolean }) {
  const closed = r.status === "reimbursed" || r.status === "rejected";
  return (
    <Link href={`/solicitudes/${r.id}`} className={`item rise ${closed ? "is-muted" : ""}`} style={{ "--i": i } as React.CSSProperties}>
      <span className="avatar">
        <Icon name="receipt" size={18} />
      </span>
      <span className="item-main">
        <span className="item-title">{r.merchant ?? r.description}</span>
        <span className="item-sub">
          #{r.id} · {showClaimant ? `${r.claimant_name ?? "Sin nombre"} · ` : ""}
          {r.merchant ? r.description : (r.receipt_date ?? "sin fecha")}
        </span>
      </span>
      <span className="item-end">
        <span className="item-amount">{shortArs(r.amount_cents)}</span>
        <span className={`item-status ${toneClass(view.tone)}`}>{view.label}</span>
      </span>
    </Link>
  );
}

export default async function EventoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireRole();
  const sp = await searchParams;
  const db = server.db();
  const cfg = server.config();
  const policy = repo.getPolicy(db);
  const requests = repo.listRequests(db);
  const isOrg = session.role === "organizer";
  let n = 0;

  return (
    <AppShell mode={cfg.paymentMode} role={session.role} eventName={policy.name}>
      <Flash error={sp.error} ok={sp.ok} />
      <EventHead eventName={policy.name} mode={cfg.paymentMode} role={session.role} />
      <div className="page">
        {isOrg ? await OrganizerHome() : CollaboratorHome()}
      </div>
    </AppShell>
  );

  async function OrganizerHome() {
    const budget = getBudget(db);
    const live = budget.committedCents - budget.paidCents;
    const wallet = await walletInfo(getAgentAddress());
    // Lo pagable de verdad: el menor entre el presupuesto libre y el saldo real de wARS (menos lo ya autorizado).
    // wei → centavos: 1 ARS = 1 wARS, 1 centavo = 10^16 wei. Todo entero.
    const walletCents = wallet.wars != null ? Number(wallet.wars / 10n ** 16n) : null;
    const walletFree = walletCents != null ? Math.max(0, walletCents - live) : null;
    const limitedByWallet = walletFree != null && walletFree < budget.availableCents;
    const payable = Math.max(0, walletFree != null ? Math.min(walletFree, budget.availableCents) : budget.availableCents);
    const unfunded =
      !wallet.address ||
      (wallet.wars != null && (wallet.wars === 0n || wallet.wars < centsToWei(Math.max(0, live)))) ||
      (wallet.celo != null && wallet.celo < MIN_CELO_WEI);
    return (
      <>
        <section className="stack gap-4" style={{ paddingTop: 20 }}>
          <p className="label">Podés pagar</p>
          <Amount cents={payable} />
          <p className="mono dim" style={{ marginTop: 6 }}>
            {walletCents == null ? (
              <>Presupuesto libre {shortArs(budget.availableCents)} · saldo sin leer</>
            ) : limitedByWallet ? (
              <>
                Lo limita la wallet: {shortArs(walletCents)} · presupuesto libre {shortArs(budget.availableCents)}
              </>
            ) : (
              <>
                Lo limita el presupuesto · wallet {shortArs(walletCents)}
              </>
            )}
          </p>
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
            <span className="dim-2">Tope {kArs(budget.totalCents)}</span>
          </div>
        </section>

        {unfunded && (
          <Link href="/wallet" className="notice notice-amb rise" style={{ marginTop: 24 }}>
            <Icon name="wallet" size={18} stroke={2} />
            <span style={{ flex: 1 }}>{wallet.address ? "Cargá la wallet: wARS para el evento y CELO para el gas." : "Falta configurar la wallet del agente."}</span>
            <Icon name="chev" size={16} stroke={2} />
          </Link>
        )}

        {requests.length === 0 ? (
          <div className="empty">
            <h2 className="display h2">Nada para revisar</h2>
            <p className="lead small">Cuando alguien cargue un gasto, aparece acá.</p>
          </div>
        ) : (
          ORG_GROUPS.map((g) => {
            const rows = requests.filter((r) => g.statuses.includes(r.status));
            if (!rows.length) return null;
            return (
              <section key={g.title} style={{ marginTop: 28 }}>
                <SectionLabel>
                  {g.title} {rows.length}
                </SectionLabel>
                <div className="list">
                  {rows.map((r) => (
                    <Item key={r.id} r={r} view={orgStatus(r)} i={n++} showClaimant />
                  ))}
                </div>
              </section>
            );
          })
        )}
      </>
    );
  }

  function CollaboratorHome() {
    const known = requests.filter((r) => r.amount_cents != null);
    const paid = known.filter((r) => r.status === "reimbursed").reduce((s, r) => s + r.amount_cents!, 0);
    const owed = known.filter((r) => r.status !== "reimbursed" && r.status !== "rejected").reduce((s, r) => s + r.amount_cents!, 0);
    return (
      <>
        <section className="stack gap-4" style={{ paddingTop: 20 }}>
          <p className="label">Te deben</p>
          <Amount cents={owed} muted={owed === 0} />
          {requests.length > 0 && (
            <>
              <div className="sp-16" />
              <Ticks total={paid + owed} segments={[{ cents: paid, kind: "live" }]} />
              <div className="ticks-legend mono">
                <span className="t-green">Cobrado {kArs(paid)}</span>
                <span className="dim">Pendiente {kArs(owed)}</span>
              </div>
            </>
          )}
        </section>
        {requests.length === 0 ? (
          <div className="empty">
            <h2 className="display h2">Tu primer gasto</h2>
            <p className="lead small">Sacale foto al ticket y el agente hace el resto.</p>
          </div>
        ) : (
          <section style={{ marginTop: 28 }}>
            <SectionLabel>Tus gastos</SectionLabel>
            <div className="list">
              {requests.map((r) => (
                <Item key={r.id} r={r} view={collabStatus(r)} i={n++} />
              ))}
            </div>
          </section>
        )}
        <div className="actions">
          <Link href="/presentar" className="btn btn-primary">
            <Icon name="cam" size={20} stroke={2} /> Nuevo gasto
          </Link>
        </div>
      </>
    );
  }
}
