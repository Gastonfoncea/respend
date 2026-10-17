// Sesiones de dos roles: cookie firmada con HMAC-SHA256. Funciones puras (sin next/headers)
// para poder testearlas; el adaptador para Next está en lib/session.ts.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Role, Session } from "./types.ts";

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

export function signSession(session: Session, secret: string): string {
  if (!secret) throw new Error("Falta SESSION_SECRET");
  const payload = Buffer.from(JSON.stringify({ r: session.role, t: session.issuedAt })).toString("base64url");
  return `${payload}.${hmac(secret, payload)}`;
}

export function verifySession(token: string | undefined | null, secret: string | null, nowMs = Date.now()): Session | null {
  if (!token || !secret) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!safeEqual(sig, hmac(secret, payload))) return null;
  try {
    const obj = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { r: unknown; t: unknown };
    if ((obj.r !== "organizer" && obj.r !== "collaborator") || typeof obj.t !== "number") return null;
    if (nowMs - obj.t > SESSION_MAX_AGE_S * 1000 || obj.t > nowMs + 60_000) return null;
    return { role: obj.r, issuedAt: obj.t };
  } catch {
    return null;
  }
}

/** Compara el passcode ingresado con el del rol, en tiempo constante. */
export function checkPasscode(input: string, expected: string | null): boolean {
  if (!expected) return false;
  const a = createHmac("sha256", "passcode").update(input).digest();
  const b = createHmac("sha256", "passcode").update(expected).digest();
  return timingSafeEqual(a, b);
}

export function assertRole(session: Session | null, roles: Role[]): Session {
  if (!session) throw new AuthError("unauthenticated", "Tenés que ingresar primero.");
  if (!roles.includes(session.role)) throw new AuthError("forbidden", "Tu rol no puede hacer esta acción.");
  return session;
}

export function actorName(session: Session): string {
  return session.role === "organizer" ? "organizador" : "colaborador";
}
