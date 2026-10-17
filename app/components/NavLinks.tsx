"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Icon, { type IconName } from "./Icon.tsx";
import type { Role } from "@/lib/types.ts";

const LINKS: { href: string; label: string; icon: IconName; match: (p: string) => boolean }[] = [
  { href: "/evento", label: "Inicio", icon: "home", match: (p) => p === "/evento" || p.startsWith("/solicitudes") || p === "/presentar" },
  { href: "/evento/politica", label: "Evento", icon: "sliders", match: (p) => p.startsWith("/evento/politica") },
  { href: "/wallet", label: "Wallet", icon: "wallet", match: (p) => p.startsWith("/wallet") },
];

export default function NavLinks({ variant, role }: { variant: "side" | "tab"; role: Role }) {
  const path = usePathname();
  return (
    <>
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} className={variant === "side" ? "side-link" : "tab"} aria-current={l.match(path) ? "page" : undefined}>
          <Icon name={l.icon} size={variant === "side" ? 18 : 22} />
          <span>{l.href === "/wallet" && role === "collaborator" ? "Mi perfil" : l.label}</span>
        </Link>
      ))}
    </>
  );
}
