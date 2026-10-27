// Cuentas y equipo: crear la cuenta, entrar, y la administración de miembros que hace el organizador.
// Regla de alta: la primera cuenta es la del organizador. Después, solo puede crear cuenta quien el organizador
// ya agregó al equipo con ese mail.
import * as repo from "./repo.ts";
import { tx } from "./db.ts";
import { assertRole, actorName } from "./auth.ts";
import { IdentityError, MIN_PASSWORD, type IdentityProvider } from "./identity.ts";
import { normalizeRecipient, unsafeRecipientReason } from "./policy.ts";
import { WorkflowError, type Ctx } from "./workflow.ts";
import type { MemberRow, Role, Session } from "./types.ts";

export interface AuthCtx extends Ctx {
  identity: IdentityProvider;
  /** Si está, solo ese mail puede crear la primera cuenta (la del organizador). */
  ownerEmail?: string | null;
}

export function normalizeEmail(raw: string): string | null {
  const e = raw.trim().toLowerCase();
  return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

/** Nombre visible: sin caracteres de control, espacios colapsados, 2 a 60 caracteres. */
export function normalizeName(raw: string): string | null {
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  return name.length >= 2 && name.length <= 60 ? name : null;
}

function cleanWallet(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null;
  const w = normalizeRecipient(raw);
  if (!w) throw new WorkflowError("Esa no es una dirección válida (0x… de 40 caracteres hex).");
  const unsafe = unsafeRecipientReason(w);
  if (unsafe) throw new WorkflowError(unsafe);
  return w;
}

/** ¿Ya hay organizador? Si no, la pantalla de ingreso ofrece crear la primera cuenta. */
export async function needsFirstOrganizer(ctx: Ctx): Promise<boolean> {
  return (await repo.countMembers(ctx.db)) === 0;
}

// --- crear cuenta y entrar ---

export interface SignUpInput {
  email: string;
  password: string;
  /** Solo para la primera cuenta: el resto ya tiene nombre (lo cargó el organizador). */
  name?: string;
}

export async function signUp(ctx: AuthCtx, input: SignUpInput): Promise<MemberRow> {
  const email = normalizeEmail(input.email);
  if (!email) throw new WorkflowError("Ese mail no parece válido.");
  if (input.password.length < MIN_PASSWORD) throw new WorkflowError(`La contraseña tiene que tener al menos ${MIN_PASSWORD} caracteres.`);
  if (input.password.length > 200) throw new WorkflowError("La contraseña es demasiado larga.");

  // 1. Quién puede crear cuenta (se vuelve a chequear al vincular, por si cambió mientras tanto).
  const first = (await repo.countMembers(ctx.db)) === 0;
  let name: string | null = null;
  if (first) {
    if (ctx.ownerEmail && normalizeEmail(ctx.ownerEmail) !== email) throw new WorkflowError("Esta instalación espera otro mail para el organizador.");
    name = normalizeName(input.name ?? "");
    if (!name) throw new WorkflowError("Escribí tu nombre (entre 2 y 60 caracteres).");
  } else {
    const m = await repo.getMemberByEmail(ctx.db, email);
    if (!m || !m.active) throw new WorkflowError("Ese mail no está en el equipo. Pedile al organizador que te agregue.");
    if (m.auth_user_id) throw new WorkflowError("Ese mail ya tiene una cuenta. Entrá con tu contraseña.");
  }

  // 2. Crear el usuario en el proveedor (afuera de la transacción: puede ser una llamada de red).
  let userId: string;
  try {
    userId = await ctx.identity.createUser(email, input.password);
  } catch (err) {
    if (err instanceof IdentityError) throw new WorkflowError(err.message);
    throw err;
  }

  // 3. Vincularlo. Si en el medio alguien ganó la carrera, se borra el usuario recién creado.
  try {
    return await tx(ctx.db, async (q) => {
      if (first) {
        if ((await repo.countMembers(q)) > 0) throw new WorkflowError("Ya se creó la cuenta del organizador. Pedile que te agregue al equipo.");
        const id = await repo.insertMember(q, { email, name: name!, role: "organizer", wallet: null, authUserId: userId });
        await repo.audit(q, null, `${name} (organizador)`, "first_organizer_created", { member_id: id, email });
        return (await repo.getMember(q, id))!;
      }
      const m = await repo.getMemberByEmail(q, email);
      if (!m || !m.active || m.auth_user_id) throw new WorkflowError("No se pudo vincular la cuenta. Probá entrar o pedile ayuda al organizador.");
      await repo.updateMember(q, m.id, { auth_user_id: userId });
      await repo.audit(q, null, m.name, "account_created", { member_id: m.id });
      return (await repo.getMember(q, m.id))!;
    });
  } catch (err) {
    await ctx.identity.deleteUser(userId).catch(() => {});
    throw err;
  }
}

/** Devuelve el miembro si el mail y la contraseña son correctos y está activo. El error no dice cuál falló. */
export async function signIn(ctx: AuthCtx, emailRaw: string, password: string): Promise<MemberRow> {
  const wrong = new WorkflowError("Mail o contraseña incorrectos.");
  const email = normalizeEmail(emailRaw);
  if (!email || !password) throw wrong;
  const userId = await ctx.identity.verifyPassword(email, password);
  if (!userId) throw wrong;
  const m = await repo.getMemberByAuthId(ctx.db, userId);
  if (!m) throw wrong;
  if (!m.active) throw new WorkflowError("Tu acceso está desactivado. Hablá con el organizador.");
  return m;
}

// --- equipo (solo organizador) ---

export interface MemberInput {
  email: string;
  name: string;
  role: string;
  wallet?: string | null;
}

function cleanRole(raw: string): Role {
  if (raw !== "organizer" && raw !== "collaborator") throw new WorkflowError("Elegí un rol.");
  return raw;
}

export async function addMember(ctx: Ctx, session: Session | null, input: MemberInput): Promise<number> {
  const s = assertRole(session, ["organizer"]);
  const email = normalizeEmail(input.email);
  if (!email) throw new WorkflowError("Ese mail no parece válido.");
  const name = normalizeName(input.name);
  if (!name) throw new WorkflowError("Escribí el nombre (entre 2 y 60 caracteres).");
  const role = cleanRole(input.role);
  const wallet = cleanWallet(input.wallet);
  return tx(ctx.db, async (q) => {
    if (await repo.getMemberByEmail(q, email)) throw new WorkflowError("Ese mail ya está en el equipo.");
    const id = await repo.insertMember(q, { email, name, role, wallet });
    await repo.audit(q, null, actorName(s), "member_added", { member_id: id, email, name, role, wallet });
    return id;
  });
}

export interface MemberUpdate {
  name?: string;
  role?: string;
  wallet?: string | null;
  active?: boolean;
}

/**
 * Cambia nombre, rol, wallet o acceso. Los gastos ya presentados conservan la wallet y el nombre de cuando
 * se presentaron (el organizador aprobó ese destino exacto). No se puede dejar la app sin organizador activo.
 */
export async function updateMember(ctx: Ctx, session: Session | null, memberId: number, input: MemberUpdate): Promise<void> {
  const s = assertRole(session, ["organizer"]);
  const fields: Parameters<typeof repo.updateMember>[2] = {};
  if (input.name !== undefined) {
    const name = normalizeName(input.name);
    if (!name) throw new WorkflowError("Escribí el nombre (entre 2 y 60 caracteres).");
    fields.name = name;
  }
  if (input.role !== undefined) fields.role = cleanRole(input.role);
  if (input.wallet !== undefined) fields.wallet = cleanWallet(input.wallet);
  if (input.active !== undefined) fields.active = input.active;
  await tx(ctx.db, async (q) => {
    const before = await repo.getMember(q, memberId);
    if (!before) throw new WorkflowError("Ese miembro no existe.");
    const losesOrganizer = before.role === "organizer" && before.active && (fields.role === "collaborator" || fields.active === false);
    if (losesOrganizer && (await repo.countActiveOrganizers(q)) <= 1) throw new WorkflowError("Tiene que quedar al menos un organizador activo.");
    const changed = Object.entries(fields).filter(([k, v]) => before[k as keyof MemberRow] !== v);
    if (!changed.length) return;
    await repo.updateMember(q, memberId, Object.fromEntries(changed));
    // Wallet nueva: los gastos que todavía no se pagan van a la wallet nueva, y si tenían una autorización
    // pendiente se revoca (el destino aprobado ya no es el vigente). Los pagados o pagándose no se tocan.
    if ("wallet" in fields && fields.wallet !== before.wallet && fields.wallet) {
      const open = (await repo.listRequestsByMember(q, memberId)).filter((r) =>
        ["submitted", "analyzed", "needs_info", "authorized", "payment_failed"].includes(r.status),
      );
      for (const r of open) {
        const auth = await repo.getActiveAuthorization(q, r.id);
        const live = (await repo.listPayments(q, r.id)).some((p) => p.status !== "failed");
        if (live) continue;
        if (auth) {
          await repo.revokeAuthorization(q, auth.id, "Cambió la wallet de cobro del miembro.");
          await repo.audit(q, r.id, actorName(s), "authorization_revoked", { authorization_id: auth.id, reason: "wallet_changed" });
        }
        await q.query("UPDATE requests SET recipient = $1, status = CASE WHEN status = 'authorized' THEN 'analyzed' ELSE status END, updated_at = $2 WHERE id = $3", [
          fields.wallet,
          new Date().toISOString(),
          r.id,
        ]);
      }
    }
    await repo.audit(q, null, actorName(s), "member_updated", {
      member_id: memberId,
      before: Object.fromEntries(changed.map(([k]) => [k, before[k as keyof MemberRow]])),
      after: Object.fromEntries(changed),
    });
  });
}

/** Borra la cuenta de acceso (no el miembro ni sus gastos): la persona vuelve a crear su contraseña con su mail. */
export async function resetAccess(ctx: AuthCtx, session: Session | null, memberId: number): Promise<void> {
  const s = assertRole(session, ["organizer"]);
  if (memberId === s.memberId) throw new WorkflowError("No podés reiniciar tu propio acceso desde acá.");
  const m = await repo.getMember(ctx.db, memberId);
  if (!m) throw new WorkflowError("Ese miembro no existe.");
  if (!m.auth_user_id) return;
  await ctx.identity.deleteUser(m.auth_user_id);
  await tx(ctx.db, async (q) => {
    await repo.updateMember(q, memberId, { auth_user_id: null });
    await repo.audit(q, null, actorName(s), "member_access_reset", { member_id: memberId });
  });
}
