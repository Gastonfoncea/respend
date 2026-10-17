// Vista "Mi wallet" del colaborador: define a qué dirección le pagan los reembolsos.
// No muestra nada de la wallet del agente (saldos, fondeo, gas): eso es solo del organizador.
import * as server from "@/lib/server.ts";
import * as repo from "@/lib/repo.ts";
import { formatBalance } from "@/lib/money.ts";
import { CHAIN_ID, WARS_ADDRESS, addressUrl } from "@/lib/config.ts";
import type { Session } from "@/lib/types.ts";
import { setMyWalletAction } from "../actions/requests.ts";
import AppShell, { EventHead } from "../components/AppShell.tsx";
import CopyAddress from "../components/CopyAddress.tsx";
import Flash from "../components/Flash.tsx";
import Icon from "../components/Icon.tsx";
import SubmitButton from "../components/SubmitButton.tsx";
import { GroupedAddress } from "../components/ui.tsx";
import { walletInfo } from "../components/wallet.ts";

export default async function CollaboratorWallet({ session, error, ok }: { session: Session; error?: string; ok?: string }) {
  const db = server.db();
  const cfg = server.config();
  const policy = repo.getPolicy(db);
  const wallet = repo.getCollaboratorWallet(db);
  const info = wallet ? await walletInfo(wallet) : null;

  return (
    <AppShell mode={cfg.paymentMode} role={session.role} eventName={policy.name}>
      <Flash error={error} ok={ok} />
      <EventHead eventName={policy.name} mode={cfg.paymentMode} role={session.role} />
      <div className="page stack gap-24">
        <section className="rise" style={{ paddingTop: 20 }}>
          <p className="label">Tu wallet de cobro</p>
          <h1 className={`display fund-state ${wallet ? "t-green" : ""}`}>{wallet ? "Lista para cobrar" : "Falta tu wallet"}</h1>
          <p className="small dim">
            Acá te depositan los reembolsos aprobados, en wARS (pesos digitales de Ripio) sobre la red Celo. 1 wARS = 1 peso.
          </p>
        </section>

        {wallet && (
          <section className="stack gap-12 rise" style={{ "--i": 1 } as React.CSSProperties}>
            <GroupedAddress address={wallet} />
            <div className="btn-row">
              <CopyAddress address={wallet} label="Copiar" className="btn btn-sm" />
              <a href={addressUrl(wallet)} target="_blank" rel="noreferrer" className="btn btn-sq btn-sm" aria-label="Ver en Celoscan">
                <Icon name="ext" size={18} stroke={2} />
              </a>
            </div>
            {info?.wars != null && (
              <p className="mono small">
                Saldo en esta wallet: <b>{formatBalance(info.wars, "wARS")}</b>
              </p>
            )}
          </section>
        )}

        <form action={setMyWalletAction} className="stack gap-16 rise" style={{ "--i": 2 } as React.CSSProperties}>
          <label className="field">
            <span className="field-label">{wallet ? "Cambiar wallet" : "Pegá tu dirección"}</span>
            <input
              className="input mono"
              name="wallet"
              required
              pattern="^\s*0x[0-9a-fA-F]{40}\s*$"
              defaultValue={wallet ?? cfg.demoCollaboratorAddress ?? ""}
              placeholder="0x…"
              spellCheck={false}
              autoComplete="off"
            />
            <span className="field-help">
              La de tu MetaMask (empieza con 0x). Es la misma dirección en todas las redes; nosotros pagamos solo en Celo.
            </span>
          </label>
          <div className="actions">
            <SubmitButton pendingText="Guardando…">{wallet ? "Guardar cambio" : "Guardar wallet"}</SubmitButton>
          </div>
        </form>

        <div className="notice rise" style={{ "--i": 3 } as React.CSSProperties}>
          <Icon name="warn" size={18} stroke={2} />
          <span>
            Si cambiás la wallet, los gastos que ya enviaste se pagan igual a la anterior: el organizador aprobó ese destino exacto.
          </span>
        </div>

        <details className="fund-more rise" style={{ "--i": 4 } as React.CSSProperties}>
          <summary>¿Cómo veo los wARS en MetaMask?</summary>
          <p className="small dim">
            Agregá la red Celo (chain ID {CHAIN_ID}, RPC https://forno.celo.org) y después importá el token wARS con este contrato:
          </p>
          <CopyAddress address={WARS_ADDRESS} />
        </details>
      </div>
    </AppShell>
  );
}
