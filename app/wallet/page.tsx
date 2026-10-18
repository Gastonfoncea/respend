import { requireRole } from "@/lib/session.ts";
import * as server from "@/lib/server.ts";
import * as repo from "@/lib/repo.ts";
import { getBudget } from "@/lib/budget.ts";
import { centsToWei, formatBalance } from "@/lib/money.ts";
import { CHAIN_ID, WARS_ADDRESS, addressUrl } from "@/lib/config.ts";
import { getAgentAddress } from "@/lib/chain/signer.ts";
import AppShell, { EventHead } from "../components/AppShell.tsx";
import AutoRefresh from "../components/AutoRefresh.tsx";
import CopyAddress from "../components/CopyAddress.tsx";
import Flash from "../components/Flash.tsx";
import Icon from "../components/Icon.tsx";
import RefreshButton from "../components/RefreshButton.tsx";
import { GroupedAddress, shortArs } from "../components/ui.tsx";
import { MIN_CELO_WEI, SUGGESTED_CELO, walletInfo } from "../components/wallet.ts";
import CollaboratorWallet from "./CollaboratorWallet.tsx";

export const dynamic = "force-dynamic";

const WEI = 10n ** 18n;
const SUGGESTED_CELO_WEI = BigInt(SUGGESTED_CELO) * WEI;

/** Rayitas encendidas en proporción value/target, con bigint (sin floats). */
function Progress({ value, target, count = 32 }: { value: bigint; target: bigint; count?: number }) {
  const lit = target > 0n ? Number(value >= target ? BigInt(count) : (value * BigInt(count)) / target) : 0;
  return (
    <div className="ticks" style={{ "--tick-h": "16px" } as React.CSSProperties} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <i key={i} className={`tick ${i < lit ? "is-live" : ""}`} style={{ "--i": i } as React.CSSProperties} />
      ))}
    </div>
  );
}

function Step({ n, done, title, sub, children }: { n: number; done: boolean; title: string; sub: string; children: React.ReactNode }) {
  return (
    <li className={`fund-step ${done ? "is-done" : ""}`}>
      <span className="fund-rail">
        <span className="fund-node">{done ? <Icon name="check" size={14} stroke={3} /> : n}</span>
        <i className="fund-line" />
      </span>
      <div className="fund-body">
        <div className="fund-head">
          <span className="fund-title">{title}</span>
          <span className="fund-sub">{sub}</span>
        </div>
        {children}
      </div>
    </li>
  );
}

const bal = (v: bigint | null, decimals = 2) => (v == null ? "—" : formatBalance(v, "", decimals).trim().replace(/,$/, ""));

export default async function WalletPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireRole();
  const sp = await searchParams;
  // El colaborador solo ve su wallet de cobro. La wallet del agente (saldos, fondeo, gas) es del organizador.
  if (session.role !== "organizer") {
    const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
    return <CollaboratorWallet session={session} error={one(sp.error)} ok={one(sp.ok)} />;
  }
  const db = await server.db();
  const cfg = server.config();
  const policy = await repo.getPolicy(db);
  const budget = await getBudget(db);
  const w = await walletInfo(getAgentAddress());
  const isOrg = session.role === "organizer";

  // Montos en centavos (enteros) y wei (bigint).
  const live = Math.max(0, budget.committedCents - budget.paidCents);
  const unpaid = Math.max(0, budget.totalCents - budget.paidCents);
  const warsTarget = centsToWei(unpaid);
  const read = w.wars != null && w.celo != null;
  const warsOk = read && w.wars! > 0n && w.wars! >= centsToWei(live);
  const celoOk = read && w.celo! >= MIN_CELO_WEI;
  const ready = warsOk && celoOk;
  const warsBelowBudget = read && w.wars! > 0n && w.wars! < warsTarget;
  const liveOver = read && live > 0 && w.wars! < centsToWei(live);

  return (
    <AppShell mode={cfg.paymentMode} role={session.role} eventName={policy.name}>
      <Flash error={sp.error} ok={sp.ok} />
      <EventHead eventName={policy.name} mode={cfg.paymentMode} role={session.role} />
      <div className="page">
        {!w.address ? (
          <div className="empty">
            <h2 className="display h2">Sin wallet</h2>
            <p className="lead small">
              Se crea con <code className="mono">npm run wallet:new</code>.
            </p>
          </div>
        ) : (
          <>
            <section className="fund-status rise" style={{ paddingTop: 20 }}>
              <AutoRefresh ms={10_000} active={!ready} />
              <div className="between">
                <p className="label">Wallet del agente</p>
                <span className="inline" style={{ gap: 14 }}>
                  {!ready && <span className="mono dim-2 live-hint">se actualiza sola</span>}
                  <RefreshButton />
                </span>
              </div>
              <h1 className={`display fund-state ${ready ? "t-green" : read ? "" : "dim"}`}>
                {!read ? "Sin lectura" : ready ? "Lista para pagar" : "Falta cargar"}
              </h1>
              <div className="fund-balances">
                <span className={warsOk ? "is-ok" : ""}>
                  <b>{bal(w.wars)}</b> wARS
                </span>
                <span className={celoOk ? "is-ok" : ""}>
                  <b>{bal(w.celo)}</b> CELO
                </span>
              </div>
              {!read && <p className="small t-amb">{w.error}</p>}
            </section>

            <ol className="fund-steps rise" style={{ "--i": 2 } as React.CSSProperties}>
              <Step n={1} done={read && (w.wars! > 0n || w.celo! > 0n)} title="Copiá la dirección" sub="Una sola, para wARS y CELO">
                <GroupedAddress address={w.address} />
                <div className="btn-row">
                  <CopyAddress address={w.address} label="Copiar dirección" className="btn btn-primary btn-sm" />
                  <a href={addressUrl(w.address)} target="_blank" rel="noreferrer" className="btn btn-sq btn-sm" aria-label="Ver en Celoscan">
                    <Icon name="ext" size={18} stroke={2} />
                  </a>
                </div>
              </Step>

              <Step n={2} done={warsOk} title="Mandá wARS" sub="La plata del evento">
                <div className="fund-meter">
                  <span className="mono">
                    <b>{bal(w.wars)}</b> de {shortArs(unpaid).replace("$", "")} del presupuesto
                  </span>
                  <Progress value={w.wars ?? 0n} target={warsTarget} />
                </div>
                {liveOver ? (
                  <p className="fund-note t-red">No cubre lo ya autorizado ({shortArs(live)}).</p>
                ) : (
                  warsBelowBudget && <p className="fund-note dim">Alcanza para {bal(w.wars, 0)} pesos en reembolsos.</p>
                )}
                {isOrg && (
                  <details className="fund-more">
                    <summary>¿Cuál es el token correcto?</summary>
                    <p className="small dim">wARS de Ripio. Si tu wallet pide el contrato, es este:</p>
                    <CopyAddress address={WARS_ADDRESS} />
                  </details>
                )}
              </Step>

              <Step n={3} done={celoOk} title="Mandá CELO" sub="El gas para mover la plata">
                <div className="fund-meter">
                  <span className="mono">
                    <b>{bal(w.celo)}</b> de {SUGGESTED_CELO} sugeridos
                  </span>
                  <Progress value={w.celo ?? 0n} target={SUGGESTED_CELO_WEI} />
                </div>
              </Step>
            </ol>

            <div className="notice notice-amb rise" style={{ "--i": 3 } as React.CSSProperties}>
              <Icon name="warn" size={18} stroke={2} />
              <span>Mandá solo por la red Celo ({CHAIN_ID}). Por otra red se pierde.</span>
            </div>
          </>
        )}

        <section className="fund-mode rise" style={{ "--i": 4 } as React.CSSProperties}>
          <span className={cfg.paymentMode === "mainnet" ? "" : "t-amb"} style={{ fontWeight: 500 }}>
            {cfg.paymentMode === "mainnet" ? "Mainnet real" : "Modo simulado"}
          </span>
          <span className="small dim">
            {cfg.paymentMode === "mainnet"
              ? "Cada pago mueve wARS reales."
              : "Ningún pago sale de esta wallet todavía. Con PAYMENT_MODE=mainnet pasan a ser reales."}
          </span>
        </section>
      </div>
    </AppShell>
  );
}
