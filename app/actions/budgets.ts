"use server";
// Presupuestos, asignaciones y categorías (solo organizador). El rol lo verifica lib/budgetAdmin.ts.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session.ts";
import * as server from "@/lib/server.ts";
import { createBudget, saveCategory, setAssignment, updateBudget } from "@/lib/budgetAdmin.ts";
import { parseArsToCents } from "@/lib/money.ts";
import { WorkflowError } from "@/lib/workflow.ts";
import { errorMessage, str, withQuery } from "./util.ts";

function intFrom(fd: FormData, key: string): number {
  const n = Number.parseInt(str(fd, key), 10);
  if (!Number.isSafeInteger(n) || n <= 0) throw new WorkflowError("Dato inválido.");
  return n;
}

const money = (fd: FormData, key: string) => {
  const raw = str(fd, key).trim();
  return raw === "" ? 0 : parseArsToCents(raw);
};

export async function createBudgetAction(fd: FormData) {
  let target = "/presupuestos";
  try {
    const id = await createBudget(await server.ctx(), await getSession(), {
      name: str(fd, "name"),
      startsOn: str(fd, "startsOn"),
      endsOn: str(fd, "endsOn"),
      autopayMaxCents: money(fd, "autopayMax"),
    });
    target = withQuery(`/presupuestos/${id}`, "ok", "Presupuesto creado. Ahora asignale montos a cada persona.");
  } catch (err) {
    target = withQuery(target, "error", errorMessage(err));
  }
  revalidatePath("/presupuestos");
  redirect(target);
}

export async function updateBudgetAction(fd: FormData) {
  let target = `/presupuestos/${str(fd, "budgetId")}`;
  try {
    const status = str(fd, "status") === "closed" ? "closed" : "open";
    await updateBudget(await server.ctx(), await getSession(), intFrom(fd, "budgetId"), {
      name: str(fd, "name"),
      startsOn: str(fd, "startsOn"),
      endsOn: str(fd, "endsOn"),
      autopayMaxCents: money(fd, "autopayMax"),
      status,
    });
    target = withQuery(target, "ok", status === "closed" ? "Presupuesto cerrado: ya no se paga nada solo." : "Presupuesto guardado.");
  } catch (err) {
    target = withQuery(target, "error", errorMessage(err));
  }
  revalidatePath("/presupuestos");
  redirect(target);
}

export async function setAssignmentAction(fd: FormData) {
  let target = `/presupuestos/${str(fd, "budgetId")}`;
  try {
    await setAssignment(await server.ctx(), await getSession(), {
      budgetId: intFrom(fd, "budgetId"),
      memberId: intFrom(fd, "memberId"),
      categoryKey: str(fd, "categoryKey") || null,
      amountCents: money(fd, "amount"),
    });
    target = withQuery(target, "ok", "Asignación guardada.");
  } catch (err) {
    target = withQuery(target, "error", errorMessage(err));
  }
  revalidatePath("/presupuestos");
  redirect(target);
}

export async function saveCategoryAction(fd: FormData) {
  let target = "/presupuestos";
  try {
    await saveCategory(await server.ctx(), await getSession(), {
      key: str(fd, "key"),
      name: str(fd, "name"),
      description: str(fd, "description"),
      active: str(fd, "active") !== "0",
    });
    target = withQuery(target, "ok", "Categoría guardada. El agente la usa desde el próximo ticket.");
  } catch (err) {
    target = withQuery(target, "error", errorMessage(err));
  }
  revalidatePath("/presupuestos");
  redirect(target);
}
