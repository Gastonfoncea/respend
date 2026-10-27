// Sesiones por persona: cookie firmada con HMAC-SHA256 con el id del miembro. Funciones puras (sin next/headers)
// para poder testearlas; el adaptador para Next está en lib/session.ts.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { MemberRow, Role, Session } from "./types.ts";

export const SESSION_COOKIE = "respend_session";
export const SESSION_MAX_AGE_S = 60 * 60 * 24 * 7;

export class AuthError extends Error {
  readonly code: "unauthenticated" | "forbidden";
  constructor(code: "unauthenticated" | "forbidden", message: string) {
    super(message);
    this.code = code;
  }
}

function hmac(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Lo que viaja en la cookie: quién es y cuándo entró. El rol se lee de la base en cada pedido. */
export interface SessionToken {
  memberId: number;
  issuedAt: number;
}

export function signSession(token: SessionToken, secret: string): string {
  if (!secret) throw new Error("Falta SESSION_SECRET");
  const payload = Buffer.from(JSON.stringify({ m: token.memberId, t: token.issuedAt })).toString("base64url");
  return `${payload}.${hmac(secret, payload)}`;
}

export function verifySession(token: string | undefined | null, secret: string | null, nowMs = Date.now()): SessionToken | null {
  if (!token || !secret) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!safeEqual(sig, hmac(secret, payload))) return null;
  try {
    const obj = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { m: unknown; t: unknown };
    if (typeof obj.m !== "number" || !Number.isSafeInteger(obj.m) || obj.m <= 0 || typeof obj.t !== "number") return null;
    if (nowMs - obj.t > SESSION_MAX_AGE_S * 1000 || obj.t > nowMs + 60_000) return null;
    return { memberId: obj.m, issuedAt: obj.t };
  } catch {
    return null;
  }
}

/** Arma la sesión con los datos vigentes del miembro. Un miembro desactivado no tiene sesión. */
export function sessionFor(token: SessionToken, member: MemberRow | null): Session | null {
  if (!member || !member.active || member.id !== token.memberId) return null;
  return { memberId: member.id, role: member.role, name: member.name, issuedAt: token.issuedAt };
}

export function assertRole(session: Session | null, roles: Role[]): Session {
  if (!session) throw new AuthError("unauthenticated", "Tenés que ingresar primero.");
  if (!roles.includes(session.role)) throw new AuthError("forbidden", "Tu rol no puede hacer esta acción.");
  return session;
}

/** Cómo aparece en la auditoría: "Ana Pérez (organizador)". */
export function actorName(session: Session): string {
  return `${session.name} (${session.role === "organizer" ? "organizador" : "colaborador"})`;
}
