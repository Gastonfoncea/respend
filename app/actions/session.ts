"use server";
import { redirect } from "next/navigation";
import { checkPasscode } from "@/lib/auth.ts";
import { readConfig } from "@/lib/config.ts";
import { clearSessionCookie, setSessionCookie } from "@/lib/session.ts";
import { str, withQuery } from "./util.ts";

export async function login(fd: FormData) {
  const role = str(fd, "role");
  const passcode = str(fd, "passcode");
  const cfg = readConfig();
  if (!cfg.sessionSecret) redirect(withQuery("/", "error", "Falta SESSION_SECRET en el entorno del servidor."));
  if (role !== "organizer" && role !== "collaborator") redirect(withQuery("/", "error", "Elegí un rol."));
  const expected = role === "organizer" ? cfg.organizerPasscode : cfg.collaboratorPasscode;
  if (!expected) redirect(withQuery("/", "error", `Falta ${role === "organizer" ? "ORGANIZER_PASSCODE" : "COLLABORATOR_PASSCODE"} en el entorno.`));
  if (!checkPasscode(passcode, expected)) redirect(withQuery("/", "error", "Passcode incorrecto."));
  await setSessionCookie(role);
  redirect("/evento");
}

export async function logout() {
  await clearSessionCookie();
  redirect("/");
}
