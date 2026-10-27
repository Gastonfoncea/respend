"use server";
// Equipo (solo organizador). El rol lo verifica lib/members.ts.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session.ts";
import * as server from "@/lib/server.ts";
import { addMember, resetAccess, updateMember } from "@/lib/members.ts";
import { WorkflowError } from "@/lib/workflow.ts";
import { errorMessage, str, withQuery } from "./util.ts";

function memberIdFrom(fd: FormData): number {
  const n = Number.parseInt(str(fd, "memberId"), 10);
  if (!Number.isSafeInteger(n) || n <= 0) throw new WorkflowError("Miembro inválido.");
  return n;
}

export async function addMemberAction(fd: FormData) {
  let target = "/equipo";
  try {
    await addMember(await server.ctx(), await getSession(), {
      email: str(fd, "email"),
      name: str(fd, "name"),
      role: str(fd, "role"),
      wallet: str(fd, "wallet") || null,
    });
    target = withQuery(target, "ok", "Listo. Avisale que entre a la app y cree su contraseña con ese mail.");
  } catch (err) {
    target = withQuery(target, "error", errorMessage(err));
  }
  revalidatePath("/equipo");
  redirect(target);
}

export async function updateMemberAction(fd: FormData) {
  let target = "/equipo";
  try {
    await updateMember(await server.ctx(), await getSession(), memberIdFrom(fd), {
      name: str(fd, "name"),
      role: str(fd, "role"),
      wallet: str(fd, "wallet") || null,
    });
    target = withQuery(target, "ok", "Cambios guardados. Los gastos ya presentados conservan la wallet de cuando se presentaron.");
  } catch (err) {
    target = withQuery(target, "error", errorMessage(err));
  }
  revalidatePath("/equipo");
  redirect(target);
}

export async function setMemberActiveAction(fd: FormData) {
  let target = "/equipo";
  try {
    const active = str(fd, "active") === "1";
    await updateMember(await server.ctx(), await getSession(), memberIdFrom(fd), { active });
    target = withQuery(target, "ok", active ? "Acceso activado." : "Acceso desactivado: ya no puede entrar.");
  } catch (err) {
    target = withQuery(target, "error", errorMessage(err));
  }
  revalidatePath("/equipo");
  redirect(target);
}

export async function resetAccessAction(fd: FormData) {
  let target = "/equipo";
  try {
    await resetAccess(await server.authCtx(), await getSession(), memberIdFrom(fd));
    target = withQuery(target, "ok", "Acceso reiniciado: puede crear una contraseña nueva con su mail.");
  } catch (err) {
    target = withQuery(target, "error", errorMessage(err));
  }
  revalidatePath("/equipo");
  redirect(target);
}
