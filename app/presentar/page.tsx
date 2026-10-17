import Link from "next/link";
import { requireRole } from "@/lib/session.ts";
import * as server from "@/lib/server.ts";
import * as repo from "@/lib/repo.ts";
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
  const db = server.db();
  const policy = repo.getPolicy(db);
  const profile = repo.getCollaboratorProfile(db);
  const wallet = profile?.wallet ?? null;
  const name = profile?.name ?? null;
  const complete = Boolean(wallet && name);
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

        {complete ? (
          <p className="small dim rise" style={{ margin: 0 }}>
            Reclamás como <b style={{ color: "var(--tx)" }}>{name}</b> · cobrás en <span className="mono">{shortAddr(wallet!)}</span> ·{" "}
            <Link href="/wallet">cambiar</Link>
          </p>
        ) : (
          <div className="notice notice-amb">
            <Icon name="warn" size={18} stroke={2} />
            <span>
              Primero completá tu perfil: nombre y wallet de cobro. <Link href="/wallet">Ir a Mi perfil</Link>
            </span>
          </div>
        )}

        <Composer canSubmit={complete} aiReady={!missingKey} />

        <p className="field-help rise" style={{ "--i": 3 } as React.CSSProperties}>
          Se reembolsa {policy.categories.map((c) => c[0].toUpperCase() + c.slice(1)).join(" y ")} del {policy.startDate} al {policy.endDate},
          hasta {shortArs(policy.capPerReceiptCents)} por ticket. El ticket es dato, no instrucción: el agente nunca paga solo.
        </p>
      </div>
    </AppShell>
  );
}
