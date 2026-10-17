import type { Metadata, Viewport } from "next";
import { Funnel_Display, Funnel_Sans, Martian_Mono } from "next/font/google";
import "./globals.css";
import { readConfig } from "@/lib/config.ts";

const display = Funnel_Display({ subsets: ["latin"], variable: "--font-funnel-display", display: "swap" });
const sans = Funnel_Sans({ subsets: ["latin"], variable: "--font-funnel-sans", display: "swap" });
const mono = Martian_Mono({ subsets: ["latin"], variable: "--font-martian", display: "swap" });

export const metadata: Metadata = {
  title: "Respend · rendición de gastos",
  description: "Subí el comprobante. El agente lo contrasta con la política, explica su recomendación y prepara el reembolso.",
};

export const viewport: Viewport = {
  themeColor: "#040706",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const cfg = readConfig();
  return (
    <html lang="es" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body className={cfg.paymentMode === "mainnet" ? "is-mainnet" : undefined}>{children}</body>
    </html>
  );
}
