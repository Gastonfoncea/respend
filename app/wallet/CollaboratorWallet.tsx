// Vista "Mi perfil" del colaborador: quién es y a qué dirección le pagan los reembolsos.
// La wallet la fija el organizador en "Equipo": el colaborador la ve, no la cambia.
// No muestra nada de la wallet del agente (saldos, fondeo, gas): eso es solo del organizador.
import * as server from "@/lib/server.ts";
import * as repo from "@/lib/repo.ts";
import { formatBalance } from "@/lib/money.ts";
import { CHAIN_ID, WARS_ADDRESS, addressUrl } from "@/lib/config.ts";
import type { Session } from "@/lib/types.ts";
import AppShell, { EventHead } from "../components/AppShell.tsx";
import CopyAddress from "../components/CopyAddress.tsx";
import Flash from "../components/Flash.tsx";
import Icon from "../components/Icon.tsx";
import { GroupedAddress } from "../components/ui.tsx";
import { walletInfo } from "../components/wallet.ts";

export default async function CollaboratorWallet({ session, error, ok }: { session: Session; error?: string; ok?: string }) {
  const db = await server.db();
  const cfg = server.config();
  const policy = await repo.getPolicy(db);
  const me = await repo.getMember(db, session.memberId);
  const wallet = me?.wallet ?? null;
  const name = session.name;
  const complete = Boolean(wallet);
  const info = wallet ? await walletInfo(wallet) : null;

  return (
    <AppShell mode={cfg.paymentMode} role={session.role} eventName={policy.name}>
      <Flash error={error} ok={ok} />
      <EventHead eventName={policy.name} mode={cfg.paymentMode} role={session.role} />
      <div className="page stack gap-24">
        <section className="rise" style={{ paddingTop: 20 }}>
          <p className="label">Tu perfil de cobro</p>
          <h1 className={`display fund-state ${complete ? "t-green" : ""}`}>
            {complete ? `Hola, ${name}` : "Falta tu wallet"}
          </h1>
          <p className="small dim">
            {me?.email ? <>Entraste con <b>{me.email}</b>. </> : null}
            El organizador ve tu nombre en cada gasto que presentás. Los reembolsos aprobados te llegan a tu wallet, en wARS (pesos
            digitales de Ripio) sobre la red Celo. 1 wARS = 1 peso.
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

        {!wallet && (
          <div className="notice notice-amb rise" style={{ "--i": 2 } as React.CSSProperties}>
            <Icon name="warn" size={18} stroke={2} />
            <span>Pasale tu dirección (la de tu MetaMask, empieza con 0x) al organizador: la carga él en &quot;Equipo&quot;. Hasta entonces no podés presentar gastos.</span>
          </div>
        )}

        <div className="notice rise" style={{ "--i": 3 } as React.CSSProperties}>
          <Icon name="warn" size={18} stroke={2} />
          <span>
            Tu wallet de cobro la fija el organizador. Si la cambia, los gastos que ya enviaste mantienen los datos de cuando los presentaste: se aprobó ese destino exacto.
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
