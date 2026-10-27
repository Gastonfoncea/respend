// Adaptador de sesiones para Next (cookies + redirect). La lógica pura está en lib/auth.ts.
// En cada pedido se relee el miembro: si lo desactivaron o le cambiaron el rol, vale enseguida.
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, SESSION_MAX_AGE_S, sessionFor, signSession, verifySession } from "./auth.ts";
import { readConfig } from "./config.ts";
import * as repo from "./repo.ts";
import * as server from "./server.ts";
import type { Role, Session } from "./types.ts";

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const token = verifySession(store.get(SESSION_COOKIE)?.value, readConfig().sessionSecret);
  if (!token) return null;
  return sessionFor(token, await repo.getMember(await server.db(), token.memberId));
}

/** Para páginas: si no hay sesión o el rol no alcanza, redirige. */
export async function requireRole(roles: Role[] = ["organizer", "collaborator"]): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/");
  if (!roles.includes(s.role)) redirect("/evento?error=" + encodeURIComponent("Tu rol no puede ver esa página."));
  return s;
}

export async function setSessionCookie(memberId: number): Promise<void> {
  const secret = readConfig().sessionSecret;
  if (!secret) throw new Error("Falta SESSION_SECRET en el entorno.");
  const store = await cookies();
  // Secure solo si la request llegó por HTTPS (en localhost con `npm start` es HTTP).
  const proto = (await headers()).get("x-forwarded-proto");
  store.set(SESSION_COOKIE, signSession({ memberId, issuedAt: Date.now() }, secret), {
    httpOnly: true,
    sameSite: "lax",
    secure: proto === "https",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
