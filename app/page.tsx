import { redirect } from "next/navigation";
import { getSession } from "@/lib/session.ts";
import * as server from "@/lib/server.ts";
import * as repo from "@/lib/repo.ts";
import { needsFirstOrganizer } from "@/lib/members.ts";
import LoginFlow, { type LoginMode } from "./components/LoginFlow.tsx";
import { ModeTag } from "./components/ui.tsx";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (await getSession()) redirect("/evento");
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
  const modeParam = one(sp.mode);
  const mode: LoginMode | null = modeParam === "signup" || modeParam === "login" ? modeParam : one(sp.email) ? "login" : null;
  const cfg = server.config();
  let eventName = "Respend";
  let firstOrganizer = false;
  try {
    const ctx = await server.ctx();
    eventName = (await repo.getPolicy(ctx.db)).name;
    firstOrganizer = await needsFirstOrganizer(ctx);
  } catch {
    /* sin base todavía: se muestra la marca */
  }
  return (
    <LoginFlow
      initialMode={mode}
      firstOrganizer={firstOrganizer}
      email={one(sp.email)}
      error={one(sp.error)}
      eventName={eventName}
      modeTag={<ModeTag mode={cfg.paymentMode} />}
    />
  );
}
