import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { getSession } from "@/lib/session.ts";
import { readConfig } from "@/lib/config.ts";
import { logout } from "./actions/session.ts";

export const metadata: Metadata = {
  title: "Respend · rendición de gastos",
  description: "Subí el comprobante. El agente lo contrasta con la política, explica su recomendación y prepara el reembolso.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const cfg = readConfig();
  return (
    <html lang="es">
      <body>
        <header className="topbar">
          <div className="wrap topbar-inner">
            <Link href={session ? "/evento" : "/"} className="brand">
              Respend
            </Link>
            <div className="topbar-right">
              {cfg.paymentMode === "mainnet" ? (
                <span className="pill pill-mainnet" title="Los pagos mueven wARS reales en Celo">
                  MAINNET
                </span>
              ) : (
                <span className="pill pill-sim" title="Los pagos no generan transacciones en Celo">
                  SIMULADO
                </span>
              )}
              {cfg.aiMode === "fake" && (
                <span className="pill pill-fake" title="AI_MODE=fake">
                  IA DE PRUEBA
                </span>
              )}
              {session && (
                <>
                  <span className="role">{session.role === "organizer" ? "Organizador" : "Colaborador"}</span>
                  <form action={logout}>
                    <button className="link" type="submit">
                      Salir
                    </button>
                  </form>
                </>
              )}
            </div>
          </div>
        </header>
        <main className="wrap">{children}</main>
        <footer className="wrap foot">
          Piloto para la hackathon &quot;Agents on Open Rails&quot; · track Stable Agents: LatAm. Los reembolsos se pagan en wARS sobre
          Celo y siempre requieren aprobación humana.
        </footer>
      </body>
    </html>
  );
}
