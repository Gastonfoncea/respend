import { requireRole } from "@/lib/session.ts";
import * as server from "@/lib/server.ts";
import * as repo from "@/lib/repo.ts";
import { submitExpenseAction } from "../actions/requests.ts";
import AppShell from "../components/AppShell.tsx";
import Flash from "../components/Flash.tsx";
import Icon from "../components/Icon.tsx";
import ReceiptPicker from "../components/ReceiptPicker.tsx";
import SubmitButton from "../components/SubmitButton.tsx";
import { TopBar, shortArs } from "../components/ui.tsx";

export const dynamic = "force-dynamic";

export default async function PresentarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireRole(["collaborator"]);
  const sp = await searchParams;
  const cfg = server.config();
  const policy = repo.getPolicy(server.db());
  const missingKey = cfg.ai.apiKey == null && cfg.aiMode === "real";

  return (
    <AppShell mode={cfg.paymentMode} role={session.role} eventName={policy.name} tabs={false}>
      <Flash error={sp.error} />
      <TopBar title="Nuevo gasto" backIcon="x" mode={cfg.paymentMode} />
      <form action={submitExpenseAction} className="page stack gap-24" encType="multipart/form-data">
        {missingKey && (
          <div className="notice notice-amb">
            <Icon name="warn" size={18} stroke={2} />
            <span>
              Falta {cfg.ai.missingKeyVar}: el agente no puede analizar. La solicitud se guarda igual.
            </span>
          </div>
        )}
        <div className="rise">
          <ReceiptPicker />
        </div>
        <label className="field rise" style={{ "--i": 1 } as React.CSSProperties}>
          <span className="field-label">¿Qué fue?</span>
          <input className="input" name="description" maxLength={1000} required placeholder="Ej.: remís para llevar el proyector" />
        </label>
        <label className="field rise" style={{ "--i": 2 } as React.CSSProperties}>
          <span className="field-label">Cobrar en</span>
          <input
            className="input mono"
            name="recipient"
            required
            pattern="^0x[0-9a-fA-F]{40}$"
            defaultValue={cfg.demoCollaboratorAddress ?? ""}
            placeholder="0x…"
            spellCheck={false}
            autoComplete="off"
          />
          <span className="field-help">Recibís wARS en Celo, 1 wARS = 1 peso. No se puede cambiar después de enviar.</span>
        </label>
        <p className="field-help rise" style={{ "--i": 3 } as React.CSSProperties}>
          Se reembolsa {policy.categories.map((c) => c[0].toUpperCase() + c.slice(1)).join(" y ")} del {policy.startDate} al {policy.endDate},
          hasta {shortArs(policy.capPerReceiptCents)} por ticket.
        </p>
        <div className="actions">
          <SubmitButton pendingText="Enviando…">
            <Icon name="up" size={20} stroke={2} /> Enviar al agente
          </SubmitButton>
        </div>
      </form>
    </AppShell>
  );
}
