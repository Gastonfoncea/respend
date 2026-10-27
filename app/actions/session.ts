"use server";
import { redirect } from "next/navigation";
import { readConfig } from "@/lib/config.ts";
import { clearSessionCookie, setSessionCookie } from "@/lib/session.ts";
import * as server from "@/lib/server.ts";
import { signIn, signUp } from "@/lib/members.ts";
import { errorMessage, str, withQuery } from "./util.ts";

function requireSecret(): void {
  if (!readConfig().sessionSecret) redirect(withQuery("/", "error", "Falta SESSION_SECRET en el entorno del servidor."));
}

export async function login(fd: FormData) {
  requireSecret();
  let target = "/evento";
  try {
    const m = await signIn(await server.authCtx(), str(fd, "email"), str(fd, "password"));
    await setSessionCookie(m.id);
  } catch (err) {
    target = withQuery(`/?email=${encodeURIComponent(str(fd, "email"))}`, "error", errorMessage(err));
  }
  redirect(target);
}

export async function createAccount(fd: FormData) {
  requireSecret();
  let target = "/evento";
  try {
    const m = await signUp(await server.authCtx(), { email: str(fd, "email"), password: str(fd, "password"), name: str(fd, "name") });
    await setSessionCookie(m.id);
  } catch (err) {
    target = withQuery(`/?mode=signup&email=${encodeURIComponent(str(fd, "email"))}`, "error", errorMessage(err));
  }
  redirect(target);
}

export async function logout() {
  await clearSessionCookie();
  redirect("/");
}
