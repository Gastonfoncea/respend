import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/session.ts";
import * as server from "@/lib/server.ts";
import * as repo from "@/lib/repo.ts";
import * as wf from "@/lib/workflow.ts";
import { reconcile } from "@/lib/chain/reconcile.ts";
import { formatArs, formatWars, centsToWei, centsToDecimalString } from "@/lib/money.ts";
import { CHAIN_ID, WARS_ADDRESS, txUrl } from "@/lib/config.ts";
import type { Check, DuplicateFlags, Explanation } from "@/lib/types.ts";
import {
  authorizeAndPayAction,
  correctAction,
  payAction,
  reconcileAction,
  rejectAction,
  requestClarificationAction,
  respondAction,
  retryAnalysisAction,
} from "../../actions/requests.ts";
import Flash from "../../components/Flash.tsx";
import CopyAddress from "../../components/CopyAddress.tsx";
import SubmitButton from "../../components/SubmitButton.tsx";
import { PAYMENT_LABEL, REC_LABEL, RULE_LABEL, STATUS_LABEL, recClass, statusClass } from "../../components/labels.ts";

export const dynamic = "force-dynamic";

const AUTHOR: Record<string, string> = { agent: "Agente", collaborator: "Colaborador", organizer: "Organizador" };

function parse<T>(s: string | null, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

function mark(ok: boolean | null) {
  if (ok === true) return <span className="ok">✓</span>;
  if (ok === false) return <span className="bad">✗</span>;
  return <span className="unk">?</span>;
}

export default async function SolicitudPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireRole();
  const sp = await searchParams;
  const id = Number.parseInt((await params).id, 10);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();
  const db = server.db();
  const cfg = server.config();
  let r = repo.getRequest(db, id);
  if (!r) notFound();

  // Reconciliar al cargar si hay un pago mainnet vivo.
  let latest = repo.latestPayment(db, id);
  if (latest && latest.mode === "mainnet" && ["signed", "sent", "uncertain"].includes(latest.status)) {
    await reconcile(db, server.chain(), latest.id).catch(() => null);
    r = repo.getRequest(db, id)!;
    latest = repo.latestPayment(db, id);
  }

  const isOrg = session.role === "organizer";
  const ai = wf.aiOutputOf(r);
  const explanation = parse<Explanation | null>(r.explanation, null);
  const checks = parse<Check[]>(r.checks, []);
  const dups = parse<DuplicateFlags>(r.duplicate_flags, { file: [], data: [] });
  const thread = repo.listClarifications(db, id);
  const auths = repo.listAuthorizations(db, id);
  const activeAuth = repo.getActiveAuthorization(db, id);
  const audit = repo.listAudit(db, id);
  const policy = repo.getPolicy(db);
  const missingKey = cfg.aiMode === "real" && !cfg.ai.apiKey;
  const canAuthorize =
    isOrg && ["analyzed", "needs_info", "payment_failed"].includes(r.status) && r.recommendation != null && r.recommendation !== "reject";
  const needsReview = r.recommendation === "flag_review" || r.recommendation === "needs_info";
  const capExceeded = r.amount_cents != null && r.amount_cents > policy.capPerReceiptCents;

  return (
    <>
      <p>
        <Link href="/evento">← Volver al evento</Link>
      </p>
      <div className="page-head">
        <div>
          <h1>Solicitud #{r.id}</h1>
          <p className="muted">{r.description}</p>
        </div>
        <div className="badges">
          <span className={statusClass(r.status)}>{STATUS_LABEL[r.status]}</span>
          {r.recommendation && <span className={recClass(r.recommendation)}>Recomendación: {REC_LABEL[r.recommendation]}</span>}
        </div>
      </div>
      <Flash error={sp.error} ok={sp.ok} />
      {r.ai_fake === 1 && <div className="stamp stamp-fake">ANÁLISIS DE PRUEBA (sin IA)</div>}

      <div className="grid-2">
        <section className="card">
          <h2>Comprobante</h2>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="receipt" src={`/api/comprobantes/${r.id}`} alt={`Comprobante de la solicitud ${r.id}`} />
          <p className="small muted">
            sha256 <code className="wrap-any">{r.file_sha256}</code>
          </p>
        </section>

        <div className="stack">
          {r.status === "submitted" && (
            <section className="card">
              <h2>Análisis</h2>
              {r.ai_error ? (
                <div className="flash flash-error">{r.ai_error}</div>
              ) : missingKey ? (
                <div className="flash flash-error">Falta {cfg.ai.missingKeyVar}: el agente no puede analizar.</div>
              ) : (
                <p className="muted">Pendiente de análisis.</p>
              )}
              <form action={retryAnalysisAction}>
                <input type="hidden" name="requestId" value={r.id} />
                <SubmitButton pendingText="El agente está leyendo el comprobante…" className="btn btn-secondary">
                  Reintentar análisis
                </SubmitButton>
              </form>
            </section>
          )}

          <section className="card">
            <h2>Datos del comprobante</h2>
            {r.fields_source === "organizer" && <p className="tag">Corregido por el organizador</p>}
            <dl className="kv">
              <dt>Fecha</dt>
              <dd>{r.receipt_date ?? "—"}</dd>
              <dt>Comercio</dt>
              <dd>{r.merchant ?? "—"}</dd>
              <dt>Concepto</dt>
              <dd>{r.concept ?? "—"}</dd>
              <dt>Importe</dt>
              <dd>{r.amount_cents != null ? formatArs(r.amount_cents) : "—"}</dd>
              <dt>Moneda</dt>
              <dd>{r.currency ?? "—"}</dd>
              <dt>Categoría</dt>
              <dd>{r.category ?? "—"}</dd>
              <dt>Wallet de destino</dt>
              <dd>
                <CopyAddress address={r.recipient} />
              </dd>
            </dl>
            {ai?.category_reasoning && <p className="small muted">Por qué esa categoría: {ai.category_reasoning}</p>}
            {isOrg && ["analyzed", "needs_info", "authorized"].includes(r.status) && (
              <details className="edit">
                <summary>Corregir datos</summary>
                {r.status === "authorized" && <p className="note">Corregir revoca la autorización vigente: hará falta autorizar de nuevo.</p>}
                <form action={correctAction} className="form">
                  <input type="hidden" name="requestId" value={r.id} />
                  <div className="row">
                    <label>
                      Fecha (AAAA-MM-DD)
                      <input name="date" defaultValue={r.receipt_date ?? ""} />
                    </label>
                    <label>
                      Importe (ARS)
                      <input name="amount" defaultValue={r.amount_cents != null ? centsToDecimalString(r.amount_cents) : ""} />
                    </label>
                  </div>
                  <label>
                    Comercio
                    <input name="merchant" defaultValue={r.merchant ?? ""} />
                  </label>
                  <label>
                    Concepto
                    <input name="concept" defaultValue={r.concept ?? ""} />
                  </label>
                  <div className="row">
                    <label>
                      Moneda
                      <input name="currency" defaultValue={r.currency ?? ""} />
                    </label>
                    <label>
                      Categoría
                      <select name="category" defaultValue={r.category ?? ""}>
                        <option value="">—</option>
                        {[...policy.categories, "otra", "indeterminada"].map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <SubmitButton pendingText="Guardando…" className="btn btn-secondary">
                    Guardar corrección
                  </SubmitButton>
                </form>
              </details>
            )}
          </section>

          {(dups.file.length > 0 || dups.data.length > 0 || (ai && (ai.suspicious_instructions.length > 0 || ai.missing_info.length > 0))) && (
            <section className="card card-alert">
              <h2>Alertas</h2>
              <ul>
                {dups.file.map((d) => (
                  <li key={`f${d}`}>
                    Archivo idéntico al de la <Link href={`/solicitudes/${d}`}>solicitud #{d}</Link>.
                  </li>
                ))}
                {dups.data.map((d) => (
                  <li key={`d${d}`}>
                    Mismo comercio, fecha e importe que la <Link href={`/solicitudes/${d}`}>solicitud #{d}</Link>.
                  </li>
                ))}
                {ai?.suspicious_instructions.map((s, i) => (
                  <li key={`s${i}`}>
                    Instrucción sospechosa dirigida al agente (se ignoró): <q>{s}</q>
                  </li>
                ))}
                {ai?.missing_info.map((m, i) => (
                  <li key={`m${i}`}>Falta: {m}</li>
                ))}
              </ul>
              {(dups.file.length > 0 || dups.data.length > 0) && <p className="small muted">Una coincidencia no es prueba de fraude.</p>}
            </section>
          )}

          {explanation && (
            <section className="card">
              <h2>
                Recomendación del agente{" "}
                {r.recommendation && <span className={recClass(r.recommendation)}>{REC_LABEL[r.recommendation]}</span>}
              </h2>
              <p>
                <strong>{explanation.summary}</strong>
              </p>
              {explanation.agentText && <p>{explanation.agentText}</p>}
              <ul className="checks">
                {checks.map((c) => (
                  <li key={c.rule}>
                    {mark(c.ok)} <span className="rule">{RULE_LABEL[c.rule]}</span> <span className="muted small">{c.detail}</span>
                  </li>
                ))}
              </ul>
              {explanation.evidence.length > 0 && (
                <p className="small muted">Evidencia leída: {explanation.evidence.map((e) => `«${e}»`).join(" · ")}</p>
              )}
              <p className="small muted">Es una recomendación. La decisión es del organizador.</p>
            </section>
          )}
        </div>
      </div>

      <section className="card">
        <h2>Aclaraciones</h2>
        {thread.length === 0 ? (
          <p className="muted">Sin aclaraciones.</p>
        ) : (
          <ol className="thread">
            {thread.map((c) => (
              <li key={c.id} className={`msg msg-${c.author}`}>
                <span className="who">{AUTHOR[c.author]}</span> <span className="small muted">{c.created_at.slice(0, 16).replace("T", " ")}</span>
                <p>{c.message}</p>
              </li>
            ))}
          </ol>
        )}
        {session.role === "collaborator" && r.status === "needs_info" && (
          <form action={respondAction} className="form">
            <input type="hidden" name="requestId" value={r.id} />
            <label>
              Tu respuesta
              <textarea name="message" rows={2} maxLength={1000} required />
            </label>
            <SubmitButton pendingText="El agente está releyendo el comprobante…">Responder</SubmitButton>
          </form>
        )}
        {isOrg && ["analyzed", "needs_info"].includes(r.status) && (
          <form action={requestClarificationAction} className="form inline-form">
            <input type="hidden" name="requestId" value={r.id} />
            <input name="message" placeholder="Pedir una aclaración al colaborador…" required maxLength={1000} />
            <SubmitButton pendingText="Enviando…" className="btn btn-secondary">
              Pedir aclaración
            </SubmitButton>
          </form>
        )}
      </section>

      {isOrg && (canAuthorize || r.status === "authorized") && r.amount_cents != null && (
        <section className="card card-auth">
          <h2>Autorización del pago</h2>
          <div className="auth-grid">
            <div>
              <div className="label">Monto</div>
              <div className="big">{formatArs(r.amount_cents)}</div>
              <div className="muted">= {formatWars(centsToWei(r.amount_cents))} (1 ARS = 1 wARS nominal)</div>
            </div>
            <div>
              <div className="label">Token</div>
              <div>
                wARS · <code className="wrap-any">{WARS_ADDRESS}</code>
              </div>
              <div className="label">Red</div>
              <div>Celo mainnet (chain {CHAIN_ID})</div>
            </div>
            <div>
              <div className="label">Destinatario</div>
              <code className="wrap-any big-addr">{r.recipient}</code>
            </div>
          </div>
          {cfg.paymentMode === "simulated" ? (
            <p className="note">Modo SIMULADO: al autorizar se registra el pago, pero no hay transacción en Celo.</p>
          ) : (
            <p className="note note-danger">Modo MAINNET: al autorizar se envían wARS reales desde la wallet del agente.</p>
          )}
          {r.status === "authorized" ? (
            <form action={payAction} className="form">
              <input type="hidden" name="requestId" value={r.id} />
              <p>Ya está autorizada (autorización #{activeAuth?.id}). Si el pago no se ejecutó, podés reintentarlo.</p>
              <SubmitButton pendingText="Pagando…">Pagar ahora</SubmitButton>
            </form>
          ) : (
            <form action={authorizeAndPayAction} className="form">
              <input type="hidden" name="requestId" value={r.id} />
              <label className="check">
                <input type="checkbox" name="verified" required /> Verifiqué monto y destinatario
              </label>
              {needsReview && (
                <>
                  <label className="check">
                    <input type="checkbox" name="reviewedAlerts" required /> Revisé las alertas
                  </label>
                  <label>
                    Motivo para autorizar igual (queda registrado)
                    <input name="reason" required maxLength={1000} />
                  </label>
                </>
              )}
              {capExceeded && <p className="note note-danger">Supera el tope por comprobante: no se puede autorizar.</p>}
              <SubmitButton pendingText="Autorizando y pagando…" disabled={capExceeded}>
                Autorizar y pagar
              </SubmitButton>
            </form>
          )}
        </section>
      )}

      {isOrg && ["submitted", "analyzed", "needs_info", "authorized", "payment_failed"].includes(r.status) && (
        <section className="card">
          <form action={rejectAction} className="form inline-form">
            <input type="hidden" name="requestId" value={r.id} />
            <input name="reason" placeholder="Motivo del rechazo (opcional)" maxLength={1000} />
            <SubmitButton pendingText="Rechazando…" className="btn btn-danger">
              Rechazar
            </SubmitButton>
          </form>
        </section>
      )}

      {latest && (
        <section className="card">
          <h2>Pago</h2>
          {latest.mode === "simulated" && <div className="stamp stamp-sim">SIMULADO — no hubo transacción en Celo</div>}
          <dl className="kv">
            <dt>Estado</dt>
            <dd>{PAYMENT_LABEL[latest.status]}</dd>
            {latest.tx_hash && (
              <>
                <dt>{latest.mode === "simulated" ? "Identificador simulado" : "Transacción"}</dt>
                <dd>
                  {latest.mode === "mainnet" ? (
                    <a href={txUrl(latest.tx_hash)} target="_blank" rel="noreferrer">
                      <code className="wrap-any">{latest.tx_hash}</code>
                    </a>
                  ) : (
                    <code className="wrap-any">{latest.tx_hash}</code>
                  )}
                </dd>
              </>
            )}
            {latest.block_number != null && (
              <>
                <dt>Bloque</dt>
                <dd>{latest.block_number}</dd>
              </>
            )}
            {latest.mode === "mainnet" && latest.attribution_ok != null && (
              <>
                <dt>Tag ERC-8021</dt>
                <dd>{latest.attribution_ok ? "✓ presente" : "✗ no encontrado"}</dd>
              </>
            )}
            {latest.error && (
              <>
                <dt>Detalle</dt>
                <dd>{latest.error}</dd>
              </>
            )}
          </dl>
          {isOrg && ["signed", "sent", "uncertain", "preparing"].includes(latest.status) && (
            <form action={reconcileAction}>
              <input type="hidden" name="requestId" value={r.id} />
              <SubmitButton pendingText="Consultando Celo…" className="btn btn-secondary">
                Reconciliar
              </SubmitButton>
            </form>
          )}
        </section>
      )}

      <section className="card">
        <h2>Trazabilidad</h2>
        <ol className="trace">
          <li>
            <strong>Comprobante</strong> · sha256 <code className="wrap-any">{r.file_sha256.slice(0, 16)}…</code> · presentado{" "}
            {r.created_at.slice(0, 16).replace("T", " ")}
          </li>
          <li>
            <strong>Análisis</strong> ·{" "}
            {r.ai_ran_at
              ? `${r.ai_fake ? "analizador de prueba" : `${r.ai_provider} · ${r.ai_model}`} · ${r.ai_ran_at.slice(0, 16).replace("T", " ")} · política v${r.policy_version}`
              : "pendiente"}
          </li>
          {auths.map((a) => (
            <li key={a.id}>
              <strong>Autorización #{a.id}</strong> · {a.authorized_by} · {a.created_at.slice(0, 16).replace("T", " ")} · binding{" "}
              <code>{a.binding_hash.slice(0, 16)}…</code>
              {a.review_note && <> · motivo: “{a.review_note}”</>}
              {a.revoked_at && <span className="bad"> · revocada: {a.revoke_reason}</span>}
            </li>
          ))}
          {repo.listPayments(db, id).map((p) => (
            <li key={p.id}>
              <strong>Pago #{p.id}</strong> · {p.mode === "simulated" ? "SIMULADO" : "mainnet"} · {PAYMENT_LABEL[p.status]}
              {p.tx_hash && p.mode === "mainnet" && (
                <>
                  {" "}
                  ·{" "}
                  <a href={txUrl(p.tx_hash)} target="_blank" rel="noreferrer">
                    {p.tx_hash.slice(0, 12)}…
                  </a>
                </>
              )}
            </li>
          ))}
        </ol>
        <details>
          <summary className="small">Registro de auditoría ({audit.length})</summary>
          <ul className="audit small">
            {audit.map((a) => (
              <li key={a.id}>
                {a.created_at.slice(0, 19).replace("T", " ")} · {a.actor} · {a.action}
              </li>
            ))}
          </ul>
        </details>
      </section>
    </>
  );
}
