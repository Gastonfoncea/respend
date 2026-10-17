import Link from "next/link";
import { requireRole } from "@/lib/session.ts";
import * as server from "@/lib/server.ts";
import * as repo from "@/lib/repo.ts";
import { formatArs } from "@/lib/money.ts";
import { submitExpenseAction } from "../actions/requests.ts";
import Flash from "../components/Flash.tsx";
import SubmitButton from "../components/SubmitButton.tsx";

export const dynamic = "force-dynamic";

export default async function PresentarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole(["collaborator"]);
  const sp = await searchParams;
  const cfg = server.config();
  const policy = repo.getPolicy(server.db());
  return (
    <>
      <p>
        <Link href="/evento">← Volver al evento</Link>
      </p>
      <h1>Presentar gasto</h1>
      <p className="muted">
        Se reembolsan gastos de {policy.categories.join(" y ")} entre el {policy.startDate} y el {policy.endDate}, hasta{" "}
        {formatArs(policy.capPerReceiptCents)} por comprobante.
      </p>
      <Flash error={sp.error} />
      {cfg.ai.apiKey == null && cfg.aiMode === "real" && (
        <div className="flash flash-error">Falta {cfg.ai.missingKeyVar}: el agente no puede analizar. La solicitud se guarda igual.</div>
      )}
      <form action={submitExpenseAction} className="card form" encType="multipart/form-data">
        <label>
          Foto del comprobante (JPEG, PNG o WebP, hasta 4 MB)
          <input type="file" name="receipt" accept="image/jpeg,image/png,image/webp" required />
        </label>
        <label>
          Descripción breve
          <textarea name="description" rows={3} maxLength={1000} required placeholder="Ej.: Remís para llevar el proyector al venue" />
        </label>
        <label>
          Wallet de destino (Celo)
          <input
            name="recipient"
            required
            pattern="^0x[0-9a-fA-F]{40}$"
            defaultValue={cfg.demoCollaboratorAddress ?? ""}
            placeholder="0x…"
            spellCheck={false}
            autoComplete="off"
          />
          <span className="hint">Ahí vas a recibir el reembolso en wARS. No se puede cambiar después de presentar.</span>
        </label>
        <SubmitButton pendingText="El agente está leyendo el comprobante…">Enviar</SubmitButton>
      </form>
    </>
  );
}
