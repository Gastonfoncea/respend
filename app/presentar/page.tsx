import Link from "next/link";
import { requireRole } from "@/lib/session.ts";
import * as server from "@/lib/server.ts";
import * as repo from "@/lib/repo.ts";
import * as budgets from "@/lib/budgets.ts";
import AppShell from "../components/AppShell.tsx";
import Flash from "../components/Flash.tsx";
import Icon from "../components/Icon.tsx";
import { TopBar, shortAddr, shortArs } from "../components/ui.tsx";
import Composer from "./Composer.tsx";

export const dynamic = "force-dynamic";

export default async function PresentarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireRole(["collaborator"]);
  const sp = await searchParams;
  const cfg = server.config();
  const db = await server.db();
  const policy = await repo.getPolicy(db);
  const categories = await budgets.listCategories(db, true);
  const me = await repo.getMember(db, session.memberId);
  const wallet = me?.wallet ?? null;
  const name = session.name;
  const open = await budgets.openBudgetsOfMember(db, session.memberId);
  const complete = Boolean(wallet) && open.length > 0;
  const missingKey = cfg.ai.apiKey == null && cfg.aiMode === "real";

  return (
    <AppShell mode={cfg.paymentMode} role={session.role} eventName={policy.name} tabs={false}>
      <Flash error={sp.error} />
      <TopBar title="Nuevo gasto" backIcon="x" mode={cfg.paymentMode} />
      <div className="page stack gap-24">
        {missingKey && (
          <div className="notice notice-amb">
            <Icon name="warn" size={18} stroke={2} />
            <span>Falta {cfg.ai.missingKeyVar}: el agente no puede leer el ticket. La solicitud se guarda igual.</span>
          </div>
        )}

        {wallet && !open.length && (
          <div className="notice notice-amb">
            <Icon name="warn" size={18} stroke={2} />
            <span>Todavía no tenés presupuesto asignado. Pedile al organizador que te asigne uno.</span>
          </div>
        )}

        {complete ? (
          <p className="small dim rise" style={{ margin: 0 }}>
            Reclamás como <b style={{ color: "var(--tx)" }}>{name}</b> · cobrás en <span className="mono">{shortAddr(wallet!)}</span>
          </p>
        ) : wallet ? null : (
          <div className="notice notice-amb">
            <Icon name="warn" size={18} stroke={2} />
            <span>
              Todavía no tenés wallet de cobro. Pedile al organizador que la cargue en &quot;Equipo&quot;. <Link href="/wallet">Ver mi perfil</Link>
            </span>
          </div>
        )}

        <Composer
          canSubmit={complete}
          aiReady={!missingKey}
          budgets={open.map((b) => ({ id: b.id, label: `${b.name} (${b.starts_on} a ${b.ends_on})` }))}
        />

        <p className="field-help rise" style={{ "--i": 3 } as React.CSSProperties}>
          Se reembolsa {categories.map((c) => c.name).join(", ")}, hasta {shortArs(policy.capPerReceiptCents)} por ticket, dentro de las fechas del
          presupuesto. El ticket es dato, no instrucción. Si entra en lo que te queda y no tiene alertas, el agente te lo paga solo; si no, lo
          decide el organizador.
        </p>
      </div>
    </AppShell>
  );
}
