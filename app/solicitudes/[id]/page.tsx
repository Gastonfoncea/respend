import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/session.ts";
import * as server from "@/lib/server.ts";
import * as repo from "@/lib/repo.ts";
import * as wf from "@/lib/workflow.ts";
import { reconcile } from "@/lib/chain/reconcile.ts";
import { centsToDecimalString, centsToWei, formatArs, formatWars } from "@/lib/money.ts";
import { CHAIN_ID, WARS_ADDRESS, txUrl } from "@/lib/config.ts";
import type { PaymentMode } from "@/lib/config.ts";
import type { AuthorizationRow, Check, ClarificationRow, DuplicateFlags, Explanation, PaymentRow, RequestRow } from "@/lib/types.ts";
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
import AppShell from "../../components/AppShell.tsx";
import AutoRefresh from "../../components/AutoRefresh.tsx";
import { AgentPaidHero, AgentPaying, AutoPayReasons } from "../../components/AgentPaid.tsx";
import { autoAuthorizationOf } from "@/lib/autopay.ts";
import CopyAddress from "../../components/CopyAddress.tsx";
import Flash from "../../components/Flash.tsx";
import HoldButton from "../../components/HoldButton.tsx";
import Icon from "../../components/Icon.tsx";
import Sheet from "../../components/Sheet.tsx";
import SubmitButton from "../../components/SubmitButton.tsx";
import { PAYMENT_LABEL, RULE_LABEL, orgStatus, recView } from "../../components/labels.ts";
import {
  Amount,
  GroupedAddress,
  Row,
  Rows,
  SectionLabel,
  StateBadge,
  Stepper,
  Ticks,
  TopBar,
  hhmm,
  shortArs,
  shortHash,
  toneClass,
} from "../../components/ui.tsx";

export const dynamic = "force-dynamic";

const AUTHOR: Record<ClarificationRow["author"], string> = { agent: "Agente", collaborator: "Colaborador", organizer: "Organizador" };

function parse<T>(s: string | null, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

const pad = (n: number) => String(n).padStart(3, "0");
const when = (iso: string) => iso.slice(0, 16).replace("T", " ");

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
  const db = await server.db();
  const cfg = server.config();
  let r = await repo.getRequest(db, id);
  if (!r) notFound();

  // Reconciliar al cargar si hay un pago mainnet vivo.
  let latest = await repo.latestPayment(db, id);
  if (latest && latest.mode === "mainnet" && ["signed", "sent", "uncertain"].includes(latest.status)) {
    await reconcile(db, server.chain(), latest.id).catch(() => null);
    r = (await repo.getRequest(db, id))!;
    latest = await repo.latestPayment(db, id);
  }

  const isOrg = session.role === "organizer";
  const ai = wf.aiOutputOf(r);
  const explanation = parse<Explanation | null>(r.explanation, null);
  const checks = parse<Check[]>(r.checks, []);
  const dups = parse<DuplicateFlags>(r.duplicate_flags, { file: [], data: [] });
  const thread = await repo.listClarifications(db, id);
  const auths = await repo.listAuthorizations(db, id);
  const payments = await repo.listPayments(db, id);
  const audit = await repo.listAudit(db, id);
  const policy = await repo.getPolicy(db);
  const missingKey = cfg.aiMode === "real" && !cfg.ai.apiKey;
  const canAuthorize =
    isOrg && ["analyzed", "needs_info", "payment_failed"].includes(r.status) && r.recommendation != null && r.recommendation !== "reject";
  const needsReview = r.recommendation === "flag_review" || r.recommendation === "needs_info";
  const capExceeded = r.amount_cents != null && r.amount_cents > policy.capPerReceiptCents;
  const canReject = isOrg && ["submitted", "analyzed", "needs_info", "authorized", "payment_failed"].includes(r.status);
  const canCorrect = isOrg && ["analyzed", "needs_info", "authorized"].includes(r.status);
  const canAsk = isOrg && ["analyzed", "needs_info"].includes(r.status);
  const livePayment = latest && ["signed", "sent", "uncertain", "preparing"].includes(latest.status);
  const rejectReason = (() => {
    const a = [...audit].reverse().find((x) => x.action === "rejected");
    return parse<{ reason?: string | null }>(a?.detail ?? null, {}).reason ?? null;
  })();
  const alerts = {
    dupFile: dups.file,
    dupData: dups.data,
    suspicious: ai?.suspicious_instructions ?? [],
    missing: ai?.missing_info ?? [],
  };
  const hasAlerts = alerts.dupFile.length + alerts.dupData.length + alerts.suspicious.length + alerts.missing.length > 0;

  // Pago automático: lo autorizó el agente (el código) y el pago corre en segundo plano.
  const autoAuth = autoAuthorizationOf(auths);
  // Si el pago en segundo plano falló antes de empezar o nunca arrancó (por ejemplo, un reinicio),
  // deja de mostrarse "pagando" y el organizador ve el botón para pagar a mano.
  const autoError = autoAuth != null && audit.some((x) => x.action === "auto_pay_error" && x.created_at >= autoAuth.created_at);
  const autoStale = autoAuth != null && r.status === "authorized" && Date.now() - Date.parse(autoAuth.created_at) > 90_000;
  const autoPaying = autoAuth != null && (r.status === "paying" || (r.status === "authorized" && !autoError && !autoStale));
  const autoPaid = autoAuth != null && r.status === "reimbursed";
  const paidSeconds =
    autoPaid && latest?.updated_at ? Math.max(1, Math.round((Date.parse(latest.updated_at) - Date.parse(autoAuth!.created_at)) / 1000)) : null;
  const autoLimit = parse<{ limit_cents?: number }>(audit.find((x) => x.action === "auto_authorized")?.detail ?? null, {}).limit_cents ?? null;

  // ---------- piezas ----------

  const agentRow = (
    <Sheet
      triggerClassName="row row-btn"
      trigger={
        <>
          <span className="row-k">Agente</span>
          {r.status === "submitted" ? (
            <span className="row-v dim">Sin análisis</span>
          ) : (
            <span className={`row-v ${toneClass(recView(r.recommendation)?.tone ?? "dim")}`}>{agentLine(r, checks)}</span>
          )}
          <Icon name="chev" size={16} stroke={2} className={`chev ${toneClass(recView(r.recommendation)?.tone ?? "dim")}`} />
        </>
      }
    >
      <AgentDetail r={r} checks={checks} explanation={explanation} categoryReasoning={ai?.category_reasoning ?? null} />
    </Sheet>
  );

  const fieldRows = (
    <Rows>
      <Row k="Comercio">{r.merchant ?? "—"}</Row>
      <Row k="Fecha">{r.receipt_date ?? "—"}</Row>
      <Row k="Categoría" tag={r.fields_source === "organizer" ? "corregido" : undefined}>
        <span style={{ textTransform: "capitalize" }}>{r.category ?? "—"}</span>
      </Row>
      <Row k="Reclama">{r.claimant_name ?? "Sin nombre"}</Row>
      <Row k="Para">
        <CopyAddress address={r.recipient} />
      </Row>
      {agentRow}
    </Rows>
  );

  const traceRow = (
    <Sheet
      triggerClassName="row row-btn"
      trigger={
        <>
          <span className="row-k">Trazabilidad</span>
          <span className="row-v mono dim">{auths.length + payments.length + 2} pasos</span>
          <Icon name="chev" size={16} stroke={2} className="chev dim" />
        </>
      }
    >
      <h2 className="display h2">Trazabilidad</h2>
      <p className="lead small">Cada paso queda registrado y es verificable.</p>
      <Trace r={r} auths={auths} payments={payments} />
      <details>
        <summary className="small dim" style={{ cursor: "pointer" }}>
          Registro de auditoría ({audit.length})
        </summary>
        <ul className="mono dim" style={{ paddingLeft: 16, lineHeight: 1.8 }}>
          {audit.map((a) => (
            <li key={a.id}>
              {when(a.created_at)} · {a.actor} · {a.action}
            </li>
          ))}
        </ul>
      </details>
    </Sheet>
  );

  return (
    <AppShell mode={cfg.paymentMode} role={session.role} eventName={policy.name} tabs={false}>
      <Flash error={sp.error} ok={sp.ok} />
      <AutoRefresh ms={2000} active={autoPaying || r.status === "paying"} />
      <TopBar title={`Solicitud ${pad(r.id)}`} mode={cfg.paymentMode} />
      {r.ai_fake === 1 && <div className="banner-fake">Análisis de prueba · sin IA</div>}
      <div className="detail">
        <div className="ticket-hero">
          <a href={`/api/comprobantes/${r.id}`} target="_blank" rel="noreferrer" aria-label="Ver el comprobante completo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/comprobantes/${r.id}`} alt={`Comprobante de la solicitud ${r.id}`} />
          </a>
        </div>
        <div className="page stack">{isOrg ? organizerView() : collaboratorView()}</div>
      </div>
    </AppShell>
  );

  // ---------- organizador ----------

  function organizerView() {
    const head = autoPaying ? (
      <AgentPaying cents={r!.amount_cents} recipient={r!.recipient} mainnet={cfg.paymentMode === "mainnet"} />
    ) : autoPaid ? (
      <>
        <AgentPaidHero cents={r!.amount_cents} payment={latest} seconds={paidSeconds} who="organizer" />
        <div className="sp-16" />
        <AutoPayReasons limitCents={autoLimit} />
      </>
    ) : paymentHead(r!, latest, cfg.paymentMode) ?? (
      <>
        <p className="label">Pide</p>
        <Amount cents={r!.amount_cents} />
        {r!.amount_cents != null && <p className="mono dim">= {formatWars(centsToWei(r!.amount_cents))} en Celo</p>}
        <p className="small dim" style={{ marginTop: 8 }}>
          “{r!.description}”
        </p>
      </>
    );

    return (
      <>
        <section className="stack gap-4 rise" style={{ paddingTop: 8 }}>
          {head}
        </section>

        {capExceeded && r!.amount_cents != null && (
          <section className="rise" style={{ marginTop: 18, "--i": 1 } as React.CSSProperties}>
            <Ticks
              total={r!.amount_cents}
              count={43}
              height={18}
              segments={[
                { cents: policy.capPerReceiptCents, kind: "paid" },
                { cents: r!.amount_cents - policy.capPerReceiptCents, kind: "over" },
              ]}
            />
            <div className="ticks-legend mono between">
              <span className="dim">Tope {shortArs(policy.capPerReceiptCents)}</span>
              <span className="t-red">+{shortArs(r!.amount_cents - policy.capPerReceiptCents)}</span>
            </div>
          </section>
        )}

        <section className="rise" style={{ marginTop: 18, "--i": 2 } as React.CSSProperties}>
          {canCorrect && (
            <SectionLabel
              action={
                <Sheet triggerClassName="btn-link inline" trigger={<><Icon name="pen" size={14} stroke={2} /> Corregir</>}>
                  <CorrectForm r={r!} categories={policy.categories} />
                </Sheet>
              }
            >
              Datos
            </SectionLabel>
          )}
          {fieldRows}
        </section>

        {hasAlerts && (
          <section className="rise" style={{ marginTop: 18, "--i": 3 } as React.CSSProperties}>
            <Alerts {...alerts} />
          </section>
        )}

        {thread.length > 0 && (
          <section className="rise" style={{ marginTop: 28, "--i": 4 } as React.CSSProperties}>
            <SectionLabel>Aclaraciones</SectionLabel>
            <Thread thread={thread} />
          </section>
        )}

        {latest && (
          <section className="rise" style={{ marginTop: 28, "--i": 5 } as React.CSSProperties}>
            <SectionLabel>Pago</SectionLabel>
            <PaymentRows p={latest} />
          </section>
        )}

        <section style={{ marginTop: 18 }}>
          <Rows>{traceRow}</Rows>
        </section>

        <div style={{ flex: 1, minHeight: 24 }} />
        <div className="actions">{organizerActions()}</div>
      </>
    );
  }

  function organizerActions() {
    const id = r!.id;
    if (autoPaying) return null;
    const askSheet = canAsk && (
      <Sheet triggerClassName="btn btn-sq" triggerLabel="Pedir aclaración" trigger={<Icon name="msg" size={20} />}>
        <h2 className="display h2">Preguntale al colaborador</h2>
        <p className="lead small">La solicitud pasa a “Falta info” hasta que responda.</p>
        <form action={requestClarificationAction} className="stack gap-16">
          <input type="hidden" name="requestId" value={id} />
          <textarea className="input" name="message" required maxLength={1000} rows={3} placeholder="¿Podés subir el ticket completo?" />
          <SubmitButton pendingText="Enviando…">Enviar pregunta</SubmitButton>
        </form>
      </Sheet>
    );
    const rejectSheet = (asPrimary: boolean) =>
      canReject && (
        <Sheet
          triggerClassName={asPrimary ? "btn btn-danger" : "btn btn-sq"}
          triggerLabel="Rechazar"
          trigger={asPrimary ? "Rechazar solicitud" : <Icon name="x" size={20} stroke={2} />}
        >
          <h2 className="display h2">Rechazar solicitud</h2>
          <form action={rejectAction} className="stack gap-16">
            <input type="hidden" name="requestId" value={id} />
            <label className="field">
              <span className="field-label">Motivo (lo ve el colaborador)</span>
              <input className="input" name="reason" maxLength={1000} placeholder="Opcional" />
            </label>
            <SubmitButton className="btn btn-danger" pendingText="Rechazando…">
              Rechazar
            </SubmitButton>
          </form>
        </Sheet>
      );

    if (r!.status === "submitted") {
      return (
        <>
          <div className="notice notice-neutral">
            <Icon name="warn" size={18} stroke={2} />
            <span>
              {r!.ai_error ?? (missingKey ? `El agente no puede analizar: falta ${cfg.ai.missingKeyVar} en el servidor.` : "Pendiente de análisis.")}
            </span>
          </div>
          <div className="btn-row">
            {rejectSheet(false)}
            <form action={retryAnalysisAction} style={{ flex: 1, display: "flex" }}>
              <input type="hidden" name="requestId" value={id} />
              <SubmitButton className="btn btn-neutral" pendingText="Leyendo el ticket…">
                <Icon name="refresh" size={18} stroke={2} /> Reintentar análisis
              </SubmitButton>
            </form>
          </div>
        </>
      );
    }

    if (livePayment && latest) {
      return (
        <>
          {latest.status === "uncertain" && (
            <div className="notice notice-amb">
              <Icon name="warn" size={18} stroke={2} />
              <span>No reintentes: podría pagarse dos veces.</span>
            </div>
          )}
          <form action={reconcileAction}>
            <input type="hidden" name="requestId" value={id} />
            <SubmitButton className="btn btn-neutral" pendingText="Consultando Celo…">
              <Icon name="refresh" size={18} stroke={2} /> Reconciliar
            </SubmitButton>
          </form>
        </>
      );
    }

    if (r!.status === "authorized") {
      return (
        <form action={payAction} className="stack gap-12">
          <input type="hidden" name="requestId" value={id} />
          <p className="small dim">Ya está autorizada. Si el pago no salió, podés intentarlo de nuevo.</p>
          <div className="btn-row">
            {rejectSheet(false)}
            <HoldButton label={cfg.paymentMode === "mainnet" ? "Mantené para pagar en mainnet" : "Mantené para pagar"} />
          </div>
        </form>
      );
    }

    if (canAuthorize && !capExceeded) {
      return (
        <div className="btn-row">
          {askSheet}
          {rejectSheet(false)}
          <Sheet triggerClassName="btn btn-primary" trigger={r!.status === "payment_failed" ? "Volver a autorizar" : "Revisar y pagar"}>
            <PayForm r={r!} needsReview={needsReview} mode={cfg.paymentMode} />
          </Sheet>
        </div>
      );
    }

    if (canReject) {
      return (
        <>
          {(capExceeded || r!.recommendation === "reject") && (
            <p className="small dim">
              {capExceeded ? "Supera el tope por ticket. Es un límite fijo: no se puede pagar." : "El agente recomienda rechazar: no se puede autorizar."}
            </p>
          )}
          <div className="btn-row">
            {askSheet}
            {rejectSheet(true)}
          </div>
        </>
      );
    }

    return (
      <Link href="/evento" className="btn btn-neutral">
        Volver a solicitudes
      </Link>
    );
  }

  // ---------- colaborador ----------

  function collaboratorView() {
    const req = r!;
    if (autoPaying) {
      return <AgentPaying cents={req.amount_cents} recipient={req.recipient} mainnet={cfg.paymentMode === "mainnet"} />;
    }
    if (req.status === "needs_info") {
      const asked = [...thread].reverse().find((c) => c.author !== "collaborator");
      return (
        <>
          <section className="stack gap-4 rise" style={{ paddingTop: 8 }}>
            <div className="between">
              <span className="label">{req.merchant ?? req.description}</span>
              <span className="display" style={{ fontSize: 20 }}>
                {shortArs(req.amount_cents)}
              </span>
            </div>
            <div className="sp-16" />
            <p className="section-label" style={{ color: "var(--amb)" }}>
              {asked ? `El ${AUTHOR[asked.author].toLowerCase()} pregunta` : "Falta información"}
            </p>
            <p className="question">{asked?.message ?? ai?.clarification_questions[0] ?? "¿Podés agregar más detalle sobre este gasto?"}</p>
          </section>
          {thread.length > 1 && (
            <section style={{ marginTop: 24 }}>
              <Thread thread={thread.slice(0, -1)} />
            </section>
          )}
          <div style={{ flex: 1, minHeight: 24 }} />
          <div className="actions">
            <form action={respondAction} className="composer">
              <input type="hidden" name="requestId" value={req.id} />
              <input name="message" required maxLength={1000} placeholder="Tu respuesta" aria-label="Tu respuesta" autoComplete="off" />
              <SubmitButton className="send" pendingText="" ariaLabel="Enviar respuesta">
                <Icon name="up" size={20} stroke={2.25} />
              </SubmitButton>
            </form>
          </div>
        </>
      );
    }

    if (req.status === "reimbursed") {
      return (
        <>
          {autoPaid ? (
            <AgentPaidHero cents={req.amount_cents} payment={latest} seconds={paidSeconds} who="collaborator" />
          ) : (
            <section className="stack gap-4" style={{ paddingTop: 16 }}>
              <StateBadge kind="ok" />
              <div className="sp-16" />
              <p className="label">Cobraste</p>
              <Amount cents={req.amount_cents} />
              {req.amount_cents != null && (
                <p className="mono dim">
                  {formatWars(centsToWei(req.amount_cents))} · {req.merchant ?? req.description}
                </p>
              )}
            </section>
          )}
          <section className="rise" style={{ marginTop: 22, "--i": 2 } as React.CSSProperties}>
            <Rows>
              <Row k="Llegó a">
                <CopyAddress address={req.recipient} />
              </Row>
              {latest && <TxRow p={latest} />}
              <Row k="Red">Celo</Row>
              <Row k="Modo" tone={latest?.mode === "mainnet" ? undefined : "amb"}>
                {latest?.mode === "mainnet" ? "Mainnet real" : "Simulado"}
              </Row>
            </Rows>
          </section>
          <div style={{ flex: 1, minHeight: 24 }} />
          <div className="actions">
            <Link href="/evento" className="btn btn-neutral">
              Listo
            </Link>
          </div>
        </>
      );
    }

    if (req.status === "rejected") {
      return (
        <>
          <section className="stack gap-4" style={{ paddingTop: 16 }}>
            <StateBadge kind="bad" />
            <div className="sp-16" />
            <p className="label t-red">Rechazado</p>
            <Amount cents={req.amount_cents} />
            <p className="small dim">{req.merchant ?? req.description}</p>
          </section>
          <section className="rise" style={{ marginTop: 22, "--i": 2 } as React.CSSProperties}>
            <Rows>
              <Row k="Motivo">{rejectReason ?? "Sin motivo"}</Row>
              <Row k="Decidió">Organizador</Row>
            </Rows>
          </section>
          <div style={{ flex: 1, minHeight: 24 }} />
          <div className="actions">
            <Link href="/presentar" className="btn btn-neutral">
              <Icon name="cam" size={18} stroke={2} /> Cargar otro gasto
            </Link>
          </div>
        </>
      );
    }

    const step = ["authorized", "paying"].includes(req.status) ? 2 : 1;
    const rec = recView(req.recommendation);
    return (
      <>
        <section className="stack gap-4 rise" style={{ paddingTop: 8 }}>
          <p className="label">{req.status === "submitted" ? "Guardado" : "Enviado al organizador"}</p>
          <Amount cents={req.amount_cents} />
          <p className="small dim">
            {req.merchant ?? req.description}
            {req.category ? ` · ${req.category}` : ""}
          </p>
        </section>
        <section className="rise" style={{ marginTop: 28, "--i": 1 } as React.CSSProperties}>
          <Stepper active={step} labels={["Enviado", "Revisión", "Cobro"]} />
        </section>
        <section className="rise" style={{ marginTop: 22, "--i": 2 } as React.CSSProperties}>
          <Rows>
            <Row k="Agente" tone={rec?.tone ?? "dim"}>
              {req.status === "submitted" ? "Sin análisis" : rec ? `Recomienda ${rec.label.toLowerCase()}` : "—"}
            </Row>
            <Row k="Organizador" tone={step === 2 ? "green" : undefined}>
              {step === 2 ? "Aprobó" : "Revisando"}
            </Row>
            <Row k="Cobro" tone="dim">
              {step === 2 ? "En curso" : "Cuando apruebe"}
            </Row>
          </Rows>
        </section>
        {req.status === "submitted" && (
          <div className="notice notice-neutral" style={{ marginTop: 18 }}>
            <Icon name="warn" size={18} stroke={2} />
            <span>{req.ai_error ?? (missingKey ? "El agente no pudo analizar el ticket todavía." : "Pendiente de análisis.")}</span>
          </div>
        )}
        <div style={{ flex: 1, minHeight: 24 }} />
        <div className="actions">
          {req.status === "submitted" && wf.canRetryAnalysis(req) ? (
            <form action={retryAnalysisAction}>
              <input type="hidden" name="requestId" value={req.id} />
              <SubmitButton className="btn btn-neutral" pendingText="Leyendo el ticket…">
                <Icon name="refresh" size={18} stroke={2} /> Reintentar análisis
              </SubmitButton>
            </form>
          ) : (
            <>
              <p className="small dim-2">Te avisamos cuando se mueva.</p>
              <Link href="/evento" className="btn btn-neutral">
                Listo
              </Link>
            </>
          )}
        </div>
      </>
    );
  }
}

// ---------- componentes de la página ----------

function agentLine(r: RequestRow, checks: Check[]): string {
  const known = checks.filter((c) => c.ok !== null);
  const ok = known.filter((c) => c.ok).length;
  if (r.recommendation === "approve") return `Cumple ${ok} de ${checks.length}`;
  return orgStatus({ status: "analyzed", recommendation: r.recommendation }).label;
}

function paymentHead(r: RequestRow, p: PaymentRow | null, mode: PaymentMode): React.ReactNode | null {
  const sub = r.amount_cents != null ? formatWars(centsToWei(r.amount_cents)) : "";
  if (r.status === "reimbursed")
    return (
      <>
        <StateBadge kind="ok" />
        <div className="sp-16" />
        <p className="label">Pagado</p>
        <Amount cents={r.amount_cents} />
        <p className="mono dim">
          {sub}
          {p?.block_number != null ? ` · bloque ${p.block_number}` : ""}
        </p>
      </>
    );
  if (r.status === "payment_failed")
    return (
      <>
        <StateBadge kind="bad" />
        <div className="sp-16" />
        <p className="label t-red">No se pagó</p>
        <Amount cents={r.amount_cents} />
        <p className="mono dim">La plata no salió de la wallet</p>
      </>
    );
  if (r.status === "payment_uncertain")
    return (
      <>
        <StateBadge kind="warn" />
        <div className="sp-16" />
        <p className="label t-amb">No sabemos si salió</p>
        <Amount cents={r.amount_cents} />
        <p className="mono dim">La red no confirmó todavía</p>
      </>
    );
  if (r.status === "paying")
    return (
      <>
        <p className="label">{mode === "mainnet" ? "Enviando a Celo" : "Registrando pago simulado"}</p>
        <Amount cents={r.amount_cents} />
        <p className="mono dim">a {shortHash(r.recipient)}</p>
        <div className="sp-24" />
        <Ticks total={40} count={40} height={28} segments={[{ cents: p?.status === "sent" ? 26 : 12, kind: "live" }]} />
      </>
    );
  if (r.status === "rejected")
    return (
      <>
        <StateBadge kind="bad" />
        <div className="sp-16" />
        <p className="label t-red">Rechazado</p>
        <Amount cents={r.amount_cents} />
        <p className="small dim">“{r.description}”</p>
      </>
    );
  return null;
}

function AgentDetail({
  r,
  checks,
  explanation,
  categoryReasoning,
}: {
  r: RequestRow;
  checks: Check[];
  explanation: Explanation | null;
  categoryReasoning: string | null;
}) {
  const rec = recView(r.recommendation);
  return (
    <>
      <p className="section-label">El agente</p>
      <h2 className={`display h1 ${rec ? toneClass(rec.tone) : ""}`}>{rec ? `Recomienda ${rec.label.toLowerCase()}` : "Sin análisis"}</h2>
      {explanation && <p style={{ margin: 0, fontWeight: 500 }}>{explanation.summary}</p>}
      {checks.length > 0 && (
        <div className="rows">
          {checks.map((c) => (
            <div key={c.rule} className="row" style={{ alignItems: "flex-start" }}>
              <span className={c.ok === true ? "t-green" : c.ok === false ? "t-red" : "dim"} style={{ paddingTop: 2 }}>
                <Icon name={c.ok === true ? "check" : c.ok === false ? "x" : "q"} size={16} stroke={2.5} />
              </span>
              <span className="stack gap-4" style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 500 }}>{RULE_LABEL[c.rule]}</span>
                <span className="small dim">{c.detail}</span>
              </span>
            </div>
          ))}
        </div>
      )}
      {explanation?.agentText && <p className="small dim" style={{ margin: 0 }}>“{explanation.agentText}”</p>}
      {categoryReasoning && <p className="small dim" style={{ margin: 0 }}>Categoría: {categoryReasoning}</p>}
      {explanation && explanation.evidence.length > 0 && (
        <p className="mono dim-2" style={{ margin: 0 }}>
          Leyó: {explanation.evidence.map((e) => `«${e}»`).join(" · ")}
        </p>
      )}
      <p className="mono dim-2" style={{ margin: 0 }}>
        {r.ai_fake ? "analizador de prueba" : (r.ai_model ?? "—")}
        {r.ai_ran_at ? ` · ${hhmm(r.ai_ran_at)}` : ""} · política v{r.policy_version ?? "—"}
      </p>
      <p className="field-help">Es una recomendación. La decisión es del organizador.</p>
    </>
  );
}

function Alerts({ dupFile, dupData, suspicious, missing }: { dupFile: number[]; dupData: number[]; suspicious: string[]; missing: string[] }) {
  return (
    <div className="alerts">
      {dupFile.map((d) => (
        <div key={`f${d}`} className="alert">
          <div className="alert-body">
            <span className="alert-title">Archivo repetido</span>
            <span className="alert-sub">
              Es idéntico al de la <Link href={`/solicitudes/${d}`}>solicitud {pad(d)}</Link>
            </span>
          </div>
        </div>
      ))}
      {dupData.map((d) => (
        <div key={`d${d}`} className="alert">
          <div className="alert-body">
            <span className="alert-title">Posible duplicado</span>
            <span className="alert-sub">
              Mismo comercio, fecha e importe que la <Link href={`/solicitudes/${d}`}>solicitud {pad(d)}</Link>. No es prueba de fraude.
            </span>
          </div>
        </div>
      ))}
      {suspicious.map((s, i) => (
        <div key={`s${i}`} className="alert" style={{ "--tone": "var(--red)" } as React.CSSProperties}>
          <div className="alert-body">
            <span className="alert-title">Instrucción en el ticket</span>
            <span className="alert-sub">Ignorada. El ticket es dato, no orden.</span>
            <span className="quote-struck">“{s}”</span>
          </div>
        </div>
      ))}
      {missing.map((m, i) => (
        <div key={`m${i}`} className="alert" style={{ "--tone": "var(--dim)" } as React.CSSProperties}>
          <div className="alert-body">
            <span className="alert-title">Falta información</span>
            <span className="alert-sub">{m}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function Thread({ thread }: { thread: ClarificationRow[] }) {
  return (
    <div className="thread">
      {thread.map((c) => (
        <div key={c.id} className={`msg msg-${c.author}`}>
          <span className="msg-who">
            {AUTHOR[c.author]} · {hhmm(c.created_at)}
          </span>
          <p className="msg-text">{c.message}</p>
        </div>
      ))}
    </div>
  );
}

function TxRow({ p }: { p: PaymentRow }) {
  if (!p.tx_hash) return null;
  return (
    <Row k={p.mode === "simulated" ? "Id simulado" : "Transacción"} mono>
      {p.mode === "mainnet" ? (
        <a href={txUrl(p.tx_hash)} target="_blank" rel="noreferrer" className="inline">
          {shortHash(p.tx_hash)} <Icon name="ext" size={14} stroke={2} />
        </a>
      ) : (
        shortHash(p.tx_hash)
      )}
    </Row>
  );
}

function PaymentRows({ p }: { p: PaymentRow }) {
  const tone = p.status === "confirmed" ? "green" : p.status === "failed" ? "red" : p.status === "uncertain" ? "amb" : undefined;
  return (
    <Rows>
      <Row k="Estado" tone={tone}>
        {PAYMENT_LABEL[p.status]}
      </Row>
      <TxRow p={p} />
      {p.block_number != null && (
        <Row k="Bloque" mono>
          {p.block_number}
        </Row>
      )}
      {p.mode === "mainnet" && p.attribution_ok != null && (
        <Row k="Atribución" tone={p.attribution_ok ? "green" : "red"}>
          {p.attribution_ok ? "verificada" : "no encontrada"}
        </Row>
      )}
      {p.nonce != null && (
        <Row k="Nonce" mono>
          {p.nonce}
        </Row>
      )}
      {p.error && <Row k="Detalle">{p.error}</Row>}
      <Row k="Modo" tone={p.mode === "mainnet" ? undefined : "amb"}>
        {p.mode === "mainnet" ? "Mainnet real" : "Simulado · sin transacción"}
      </Row>
    </Rows>
  );
}

function Trace({ r, auths, payments }: { r: RequestRow; auths: AuthorizationRow[]; payments: PaymentRow[] }) {
  return (
    <ol className="timeline">
      <li>
        <span className="rail">
          <i className="node" />
          <i className="line" />
        </span>
        <span className="tl-body">
          <span className="tl-head">
            Comprobante <span className="mono dim-2">{hhmm(r.created_at)}</span>
          </span>
          <span className="tl-sub mono">sha256 {r.file_sha256.slice(0, 16)}…</span>
        </span>
      </li>
      <li>
        <span className="rail">
          <i className={`node ${r.ai_ran_at ? "" : "is-off"}`} />
          <i className="line" />
        </span>
        <span className="tl-body">
          <span className="tl-head">
            Análisis <span className="mono dim-2">{hhmm(r.ai_ran_at)}</span>
          </span>
          <span className="tl-sub mono">
            {r.ai_ran_at ? `${r.ai_fake ? "analizador de prueba" : `${r.ai_provider} · ${r.ai_model}`} · política v${r.policy_version}` : "pendiente"}
          </span>
        </span>
      </li>
      {auths.map((a) => (
        <li key={`a${a.id}`}>
          <span className="rail">
            <i className={`node ${a.revoked_at ? "is-off" : ""}`} />
            <i className="line" />
          </span>
          <span className="tl-body">
            <span className="tl-head">
              Autorización <span className="mono dim-2">{hhmm(a.created_at)}</span>
            </span>
            <span className="tl-sub mono">
              {a.authorized_by} · binding {a.binding_hash.slice(0, 12)}…{a.review_note ? ` · motivo: “${a.review_note}”` : ""}
              {a.revoked_at ? ` · revocada: ${a.revoke_reason}` : ""}
            </span>
          </span>
        </li>
      ))}
      {payments.map((p) => (
        <li key={`p${p.id}`}>
          <span className="rail">
            <i className={`node ${p.status === "failed" ? "is-bad" : p.status === "confirmed" ? "" : "is-off"}`} />
            <i className="line" />
          </span>
          <span className="tl-body">
            <span className="tl-head">
              {p.mode === "simulated" ? "Pago simulado" : "Transacción"} <span className="mono dim-2">{hhmm(p.updated_at)}</span>
            </span>
            <span className="tl-sub mono">
              {PAYMENT_LABEL[p.status]}
              {p.tx_hash ? ` · ${shortHash(p.tx_hash)}` : ""}
              {p.block_number != null ? ` · bloque ${p.block_number}` : ""}
              {p.mode === "mainnet" && p.attribution_ok != null ? ` · atribución ${p.attribution_ok ? "verificada" : "no encontrada"}` : ""}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function CorrectForm({ r, categories }: { r: RequestRow; categories: string[] }) {
  return (
    <>
      <h2 className="display h2 inline">
        <Icon name="pen" size={18} /> Corregir datos
      </h2>
      {r.status === "authorized" && (
        <div className="notice notice-amb">
          <Icon name="warn" size={18} stroke={2} />
          <span>Corregir revoca la autorización vigente: hará falta autorizar de nuevo.</span>
        </div>
      )}
      <form action={correctAction} className="stack gap-12">
        <input type="hidden" name="requestId" value={r.id} />
        <div className="grid-2">
          <label className="field">
            <span className="field-label">Fecha</span>
            <input className="input" name="date" placeholder="AAAA-MM-DD" defaultValue={r.receipt_date ?? ""} />
          </label>
          <label className="field">
            <span className="field-label">Importe (ARS)</span>
            <input className="input" name="amount" inputMode="decimal" defaultValue={r.amount_cents != null ? centsToDecimalString(r.amount_cents) : ""} />
          </label>
        </div>
        <label className="field">
          <span className="field-label">Comercio</span>
          <input className="input" name="merchant" defaultValue={r.merchant ?? ""} />
        </label>
        <label className="field">
          <span className="field-label">Concepto</span>
          <input className="input" name="concept" defaultValue={r.concept ?? ""} />
        </label>
        <div className="grid-2">
          <label className="field">
            <span className="field-label">Moneda</span>
            <input className="input" name="currency" defaultValue={r.currency ?? ""} />
          </label>
          <label className="field">
            <span className="field-label">Categoría</span>
            <select className="input" name="category" defaultValue={r.category ?? ""}>
              <option value="">—</option>
              {[...categories, "otra", "indeterminada"].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="field-help">Queda marcado como corregido por el organizador. Se vuelven a chequear las reglas; la IA no.</p>
        <SubmitButton pendingText="Guardando…">Guardar</SubmitButton>
      </form>
    </>
  );
}

function PayForm({ r, needsReview, mode }: { r: RequestRow; needsReview: boolean; mode: PaymentMode }) {
  return (
    <>
      <h2 className="display h2">Antes de pagar</h2>
      <Amount cents={r.amount_cents} size="sm" suffix=" ARS" />
      <p className="mono dim" style={{ margin: 0 }}>
        = {r.amount_cents != null ? formatWars(centsToWei(r.amount_cents)) : "—"} · Celo {CHAIN_ID}
      </p>
      <div className="panel stack gap-8">
        <span className="small dim">Reclama</span>
        <span>{r.claimant_name ?? "Sin nombre (presentado antes de que existiera el perfil)"}</span>
        <span className="small dim">Destino completo</span>
        <GroupedAddress address={r.recipient} />
      </div>
      <p className="mono dim-2" style={{ margin: 0, overflowWrap: "anywhere" }}>
        Token wARS {WARS_ADDRESS}
      </p>
      <form action={authorizeAndPayAction} className="stack gap-12">
        <input type="hidden" name="requestId" value={r.id} />
        {needsReview && (
          <>
            <label className="check">
              <input type="checkbox" name="reviewedAlerts" required /> Revisé las alertas
            </label>
            <input className="input" name="reason" required maxLength={1000} placeholder="Motivo para pagar igual (queda registrado)" />
          </>
        )}
        <label className="check">
          <input type="checkbox" name="verified" required /> Verifiqué monto y destinatario
        </label>
        {mode === "mainnet" ? (
          <div className="notice notice-red">
            <Icon name="warn" size={18} stroke={2} />
            <span>Mainnet: se envían wARS reales desde la wallet del agente.</span>
          </div>
        ) : (
          <p className="field-help">Simulado: se registra el pago, pero no hay transacción en Celo.</p>
        )}
        <HoldButton label={mode === "mainnet" ? "Mantené para pagar en mainnet" : "Mantené para pagar"} />
        <p className="field-help" style={{ textAlign: "center" }}>
          {formatArs(r.amount_cents ?? 0)} · mantené apretado 1 segundo
        </p>
      </form>
    </>
  );
}
