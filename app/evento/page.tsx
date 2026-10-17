import Link from "next/link";
import { requireRole } from "@/lib/session.ts";
import * as server from "@/lib/server.ts";
import * as repo from "@/lib/repo.ts";
import { getBudget } from "@/lib/budget.ts";
import { formatArs, formatBalance, centsToDecimalString } from "@/lib/money.ts";
import { addressUrl, WARS_ADDRESS } from "@/lib/config.ts";
import { getAgentAddress } from "@/lib/chain/signer.ts";
import { KNOWN_CATEGORIES } from "@/lib/workflow.ts";
import { updatePolicyAction } from "../actions/requests.ts";
import Flash from "../components/Flash.tsx";
import CopyAddress from "../components/CopyAddress.tsx";
import SubmitButton from "../components/SubmitButton.tsx";
import { REC_LABEL, STATUS_LABEL, recClass, statusClass } from "../components/labels.ts";

export const dynamic = "force-dynamic";

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
}

async function walletInfo(address: string | null) {
  if (!address) return { address: null, wars: null, celo: null, error: null };
  try {
    const c = server.chain();
    const [wars, celo] = await withTimeout(
      Promise.all([c.getTokenBalance(WARS_ADDRESS, address as `0x${string}`), c.getNativeBalance(address as `0x${string}`)]),
      6000,
    );
    return { address, wars, celo, error: null };
  } catch {
    return { address, wars: null, celo: null, error: "No se pudo leer el saldo de Celo en este momento." };
  }
}

export default async function EventoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireRole();
  const sp = await searchParams;
  const db = server.db();
  const cfg = server.config();
  const policy = repo.getPolicy(db);
  const budget = getBudget(db);
  const requests = repo.listRequests(db);
  const locked = requests.length > 0;
  const isOrg = session.role === "organizer";
  const wallet = await walletInfo(getAgentAddress());
  const pct = (n: number) => (budget.totalCents > 0 ? Math.min(100, Math.round((n * 100) / budget.totalCents)) : 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{policy.name}</h1>
          <p className="muted">
            Del {policy.startDate} al {policy.endDate} · política v{policy.version}
          </p>
        </div>
        {session.role === "collaborator" && (
          <Link href="/presentar" className="btn">
            Presentar gasto
          </Link>
        )}
      </div>
      <Flash error={sp.error} ok={sp.ok} />

      <div className="grid-3">
        <section className="card">
          <h2>Política de gastos</h2>
          <dl className="kv">
            <dt>Categorías</dt>
            <dd>{policy.categories.join(", ")}</dd>
            <dt>Tope por comprobante</dt>
            <dd>{formatArs(policy.capPerReceiptCents)}</dd>
            <dt>Moneda</dt>
            <dd>ARS (pesos argentinos)</dd>
          </dl>
          {isOrg &&
            (locked ? (
              <p className="note">La política quedó bloqueada porque ya hay solicitudes: cambiarla ahora alteraría reglas ya aplicadas.</p>
            ) : (
              <details className="edit">
                <summary>Editar política</summary>
                <form action={updatePolicyAction} className="form">
                  <label>
                    Nombre del evento
                    <input name="name" defaultValue={policy.name} required />
                  </label>
                  <div className="row">
                    <label>
                      Desde
                      <input type="date" name="startDate" defaultValue={policy.startDate} required />
                    </label>
                    <label>
                      Hasta
                      <input type="date" name="endDate" defaultValue={policy.endDate} required />
                    </label>
                  </div>
                  <label>
                    Categorías (separadas por coma; soportadas: {KNOWN_CATEGORIES.join(", ")})
                    <input name="categories" defaultValue={policy.categories.join(", ")} required />
                  </label>
                  <div className="row">
                    <label>
                      Tope por comprobante (ARS)
                      <input name="cap" defaultValue={centsToDecimalString(policy.capPerReceiptCents)} required />
                    </label>
                    <label>
                      Presupuesto (ARS)
                      <input name="budget" defaultValue={centsToDecimalString(policy.budgetCents)} required />
                    </label>
                  </div>
                  <SubmitButton pendingText="Guardando…">Guardar política</SubmitButton>
                </form>
              </details>
            ))}
        </section>

        <section className="card">
          <h2>Presupuesto</h2>
          <div className="big">{formatArs(budget.availableCents)}</div>
          <p className="muted">disponible de {formatArs(budget.totalCents)}</p>
          <div className="bar" aria-label="Uso del presupuesto">
            <span className="bar-paid" style={{ width: `${pct(budget.paidCents)}%` }} />
            <span className="bar-committed" style={{ width: `${pct(budget.committedCents - budget.paidCents)}%` }} />
          </div>
          <dl className="kv kv-money">
            <dt>
              <i className="dot dot-paid" /> Pagado
            </dt>
            <dd>{formatArs(budget.paidCents)}</dd>
            <dt>
              <i className="dot dot-committed" /> Comprometido (incluye pagado)
            </dt>
            <dd>{formatArs(budget.committedCents)}</dd>
          </dl>
        </section>

        <section className="card">
          <h2>Wallet del agente</h2>
          <p className="muted small">
            wARS es un token de Ripio que representa pesos argentinos en la red Celo. Los reembolsos salen de esta wallet.
          </p>
          {wallet.address ? (
            <>
              <p>
                <CopyAddress address={wallet.address} />{" "}
                <a href={addressUrl(wallet.address)} target="_blank" rel="noreferrer">
                  Ver en Celoscan
                </a>
              </p>
              {wallet.error ? (
                <p className="note">{wallet.error}</p>
              ) : (
                <dl className="kv">
                  <dt>Saldo wARS (mainnet)</dt>
                  <dd>{formatBalance(wallet.wars!, "wARS")}</dd>
                  <dt>Saldo CELO (para gas)</dt>
                  <dd>{formatBalance(wallet.celo!, "CELO", 4)}</dd>
                </dl>
              )}
            </>
          ) : (
            <p className="note">
              Sin configurar. Se crea con <code>npm run wallet:new</code> en la máquina del organizador.
            </p>
          )}
          <p>
            Modo de pago: <strong>{cfg.paymentMode === "mainnet" ? "MAINNET (wARS reales)" : "SIMULADO (sin transacciones)"}</strong>
          </p>
          <p className="note small">
            Los límites los aplica esta app, no un contrato. Quien controle la clave del agente podría mover fondos fuera de la app.
          </p>
        </section>
      </div>

      <section className="card">
        <h2>Solicitudes</h2>
        {requests.length === 0 ? (
          <p className="muted">Todavía no hay gastos presentados.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Descripción</th>
                  <th>Comercio</th>
                  <th className="num">Importe</th>
                  <th>Recomendación</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/solicitudes/${r.id}`}>#{r.id}</Link>
                    </td>
                    <td>
                      <Link href={`/solicitudes/${r.id}`}>{r.description}</Link>
                    </td>
                    <td>{r.merchant ?? "—"}</td>
                    <td className="num">{r.amount_cents != null ? formatArs(r.amount_cents) : "—"}</td>
                    <td>{r.recommendation ? <span className={recClass(r.recommendation)}>{REC_LABEL[r.recommendation]}</span> : "—"}</td>
                    <td>
                      <span className={statusClass(r.status)}>{STATUS_LABEL[r.status]}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
