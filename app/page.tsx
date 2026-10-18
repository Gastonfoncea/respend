import { redirect } from "next/navigation";
import { getSession } from "@/lib/session.ts";
import * as server from "@/lib/server.ts";
import * as repo from "@/lib/repo.ts";
import type { Role } from "@/lib/types.ts";
import LoginFlow from "./components/LoginFlow.tsx";
import { ModeTag } from "./components/ui.tsx";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (await getSession()) redirect("/evento");
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
  const roleParam = one(sp.role);
  const role: Role | null = roleParam === "organizer" || roleParam === "collaborator" ? roleParam : null;
  const cfg = server.config();
  let eventName = "Respend";
  try {
    eventName = (await repo.getPolicy(await server.db())).name;
  } catch {
    /* sin base todavía: se muestra la marca */
  }
  return <LoginFlow initialRole={role} error={one(sp.error)} eventName={eventName} modeTag={<ModeTag mode={cfg.paymentMode} />} />;
}
