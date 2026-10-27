// Cuentas, equipo y privacidad entre colaboradores (proveedor de identidad local, sin red).
import test from "node:test";
import assert from "node:assert/strict";
import { AuthError } from "../lib/auth.ts";
import { addMember, needsFirstOrganizer, resetAccess, signIn, signUp, updateMember } from "../lib/members.ts";
import { analyzeRequest, authorize, previewExpense, requestFor, respondClarification, submitExpense, visibleRequests, WorkflowError } from "../lib/workflow.ts";
import { openPglite } from "../lib/db.ts";
import { createLocalIdentity } from "../lib/identity.ts";
import { createFsReceiptStore } from "../lib/receipts.ts";
import * as repo from "../lib/repo.ts";
import { DEMO_POLICY } from "../lib/demo.ts";
import type { Session } from "../lib/types.ts";
import { aiOut, makeCtx, scriptedAnalyzer, BUDGET_ID, COLLAB, COLLAB_ID, ORG, ORG_ID, RECIPIENT, tinyPng, tmpDir, type TestCtx } from "./helpers.ts";
import { setAssignment } from "../lib/budgetAdmin.ts";
import { createPayTool } from "../lib/chain/payTool.ts";

const OTHER = "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359";
const OK = { verifiedAmountAndRecipient: true, reviewedAlerts: false, reason: "" };
const submit = (ctx: TestCtx, session: Session, seed = 1) =>
  submitExpense(ctx, session, { description: "remís", file: { bytes: tinyPng(seed), mime: "image/png" } });

/** Base vacía, sin miembros (como recién instalada). */
async function emptyCtx(ownerEmail: string | null = null): Promise<TestCtx> {
  const db = await openPglite();
  await repo.upsertEvent(db, DEMO_POLICY);
  return {
    db,
    receipts: createFsReceiptStore(tmpDir()),
    analyzer: scriptedAnalyzer(() => aiOut()),
    identity: createLocalIdentity(db),
    ownerEmail,
    dir: tmpDir(),
  };
}

test("la primera cuenta es la del organizador; después nadie más puede autoproclamarse", async () => {
  const ctx = await emptyCtx();
  assert.equal(await needsFirstOrganizer(ctx), true);
  await assert.rejects(signUp(ctx, { email: "ana@x.com", password: "12345678" }), /nombre/);
  await assert.rejects(signUp(ctx, { email: "ana@x.com", password: "corta", name: "Ana" }), /8 caracteres/);
  const ana = await signUp(ctx, { email: " Ana@X.com ", password: "12345678", name: "Ana" });
  assert.equal(ana.role, "organizer");
  assert.equal(ana.email, "ana@x.com");
  assert.equal(await needsFirstOrganizer(ctx), false);
  // Un desconocido ya no puede crear cuenta.
  await assert.rejects(signUp(ctx, { email: "intruso@x.com", password: "12345678", name: "X" }), /no está en el equipo/);
  assert.equal((await signIn(ctx, "ANA@x.com", "12345678")).id, ana.id);
  await db_close(ctx);
});

test("OWNER_EMAIL: solo ese mail puede crear la cuenta del organizador", async () => {
  const ctx = await emptyCtx("duena@x.com");
  await assert.rejects(signUp(ctx, { email: "otra@x.com", password: "12345678", name: "Otra" }), /otro mail/);
  assert.equal((await signUp(ctx, { email: "duena@x.com", password: "12345678", name: "Dueña" })).role, "organizer");
  await db_close(ctx);
});

test("alta por invitación: el organizador agrega el mail y la persona crea su contraseña", async () => {
  const ctx = await makeCtx();
  await assert.rejects(signUp(ctx, { email: "pedro@x.com", password: "12345678" }), /no está en el equipo/);
  const id = await addMember(ctx, ORG, { email: "Pedro@x.com", name: "Pedro", role: "collaborator", wallet: OTHER });
  const pedro = await signUp(ctx, { email: "pedro@x.com", password: "clave-segura" });
  assert.equal(pedro.id, id);
  assert.equal(pedro.role, "collaborator");
  await assert.rejects(signUp(ctx, { email: "pedro@x.com", password: "otra-clave" }), /ya tiene una cuenta/);
  assert.equal((await signIn(ctx, "pedro@x.com", "clave-segura")).id, id);
  await assert.rejects(signIn(ctx, "pedro@x.com", "mal"), /incorrectos/);
  await assert.rejects(signIn(ctx, "nadie@x.com", "clave-segura"), /incorrectos/);
});

test("solo el organizador administra el equipo; mail repetido y wallet inválida se rechazan", async () => {
  const ctx = await makeCtx();
  await assert.rejects(addMember(ctx, COLLAB, { email: "a@x.com", name: "A A", role: "collaborator" }), (e: unknown) => e instanceof AuthError && e.code === "forbidden");
  await assert.rejects(addMember(ctx, null, { email: "a@x.com", name: "A A", role: "collaborator" }), AuthError);
  await assert.rejects(addMember(ctx, ORG, { email: "juan@equipo.test", name: "Juan 2", role: "collaborator" }), /ya está/);
  await assert.rejects(addMember(ctx, ORG, { email: "b@x.com", name: "B B", role: "collaborator", wallet: "0x123" }), WorkflowError);
  await assert.rejects(addMember(ctx, ORG, { email: "b@x.com", name: "B B", role: "collaborator", wallet: "0x1111111111111111111111111111111111111111" }), /prueba/);
  await assert.rejects(addMember(ctx, ORG, { email: "b@x.com", name: "B B", role: "jefe" }), /rol/);
  await assert.rejects(updateMember(ctx, COLLAB, COLLAB_ID, { wallet: OTHER }), AuthError);
});

test("no se puede dejar la app sin organizador activo", async () => {
  const ctx = await makeCtx();
  await assert.rejects(updateMember(ctx, ORG, ORG_ID, { role: "collaborator" }), /al menos un organizador/);
  await assert.rejects(updateMember(ctx, ORG, ORG_ID, { active: false }), /al menos un organizador/);
  // Con otro organizador activo, sí.
  const id = await addMember(ctx, ORG, { email: "beto@x.com", name: "Beto", role: "organizer" });
  await updateMember(ctx, ORG, ORG_ID, { role: "collaborator" });
  assert.equal((await repo.getMember(ctx.db, ORG_ID))!.role, "collaborator");
  assert.ok(await repo.getMember(ctx.db, id));
});

test("quitar el acceso corta el ingreso", async () => {
  const ctx = await makeCtx();
  await addMember(ctx, ORG, { email: "caro@x.com", name: "Caro", role: "collaborator", wallet: OTHER });
  const caro = await signUp(ctx, { email: "caro@x.com", password: "12345678" });
  await updateMember(ctx, ORG, caro.id, { active: false });
  await assert.rejects(signIn(ctx, "caro@x.com", "12345678"), /desactivado/);
});

test("reiniciar el acceso borra la contraseña y permite crear una nueva", async () => {
  const ctx = await makeCtx();
  await addMember(ctx, ORG, { email: "dani@x.com", name: "Dani", role: "collaborator", wallet: OTHER });
  const dani = await signUp(ctx, { email: "dani@x.com", password: "vieja-clave" });
  await assert.rejects(resetAccess(ctx, COLLAB, dani.id), AuthError);
  await assert.rejects(resetAccess(ctx, ORG, ORG_ID), /propio acceso/);
  await resetAccess(ctx, ORG, dani.id);
  await assert.rejects(signIn(ctx, "dani@x.com", "vieja-clave"), /incorrectos/);
  await signUp(ctx, { email: "dani@x.com", password: "nueva-clave" });
  assert.equal((await signIn(ctx, "dani@x.com", "nueva-clave")).id, dani.id);
});

test("el gasto se paga a la wallet que fijó el organizador y guarda quién lo presentó", async () => {
  const ctx = await makeCtx();
  const id = await submit(ctx, COLLAB);
  const r = (await repo.getRequest(ctx.db, id))!;
  assert.equal(r.recipient, RECIPIENT);
  assert.equal(r.member_id, COLLAB_ID);
  assert.equal(r.claimant_name, COLLAB.name);
  // No se acepta otra wallet desde el formulario.
  await assert.rejects(
    submitExpense(ctx, COLLAB, { description: "x", recipient: OTHER, file: { bytes: tinyPng(2), mime: "image/png" } }),
    /perfil/,
  );
  // Sin wallet cargada no se puede presentar.
  const sinWallet = await addMember(ctx, ORG, { email: "eli@x.com", name: "Eli", role: "collaborator" });
  await assert.rejects(submit(ctx, { memberId: sinWallet, role: "collaborator", name: "Eli", issuedAt: Date.now() }, 3), /wallet de cobro/);
});

test("cambiar la wallet revoca la autorización pendiente y el gasto pasa a la wallet nueva; lo pagado no se toca", async () => {
  const ctx = await makeCtx();
  const paid = await submit(ctx, COLLAB, 5);
  await analyzeRequest(ctx, paid);
  await authorize(ctx, ORG, paid, OK);
  await createPayTool({ db: ctx.db, mode: "simulated" })(paid);
  const id = await submit(ctx, COLLAB);
  await analyzeRequest(ctx, id);
  // Mismos datos que el anterior (analizador de prueba): sale como posible duplicado y se autoriza con motivo.
  await authorize(ctx, ORG, id, { ...OK, reviewedAlerts: true, reason: "revisado" });
  await updateMember(ctx, ORG, COLLAB_ID, { wallet: OTHER });
  const r = (await repo.getRequest(ctx.db, id))!;
  assert.equal(r.recipient, OTHER);
  assert.equal(r.status, "analyzed");
  assert.equal(await repo.getActiveAuthorization(ctx.db, id), null);
  assert.ok((await repo.listAudit(ctx.db, id)).some((a) => a.action === "authorization_revoked" && a.detail?.includes("wallet_changed")));
  // Lo ya pagado conserva su destino.
  assert.equal((await repo.getRequest(ctx.db, paid))!.recipient, RECIPIENT);
  assert.equal((await repo.getRequest(ctx.db, paid))!.status, "reimbursed");
  assert.equal((await repo.getRequest(ctx.db, await submit(ctx, COLLAB, 2)))!.recipient, OTHER);
  const [{ n }] = await ctx.db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM audit_log WHERE action = 'member_updated'");
  assert.equal(n, 1);
});

test("privacidad: un colaborador no ve ni responde gastos de otro; el organizador ve todo", async () => {
  const ctx = await makeCtx(scriptedAnalyzer(() => aiOut({ recommendation: "needs_info", category: "indeterminada", clarification_questions: ["¿Qué?"] })));
  const otroId = await addMember(ctx, ORG, { email: "fede@x.com", name: "Fede", role: "collaborator", wallet: OTHER });
  await setAssignment(ctx, ORG, { budgetId: BUDGET_ID, memberId: otroId, categoryKey: null, amountCents: 100000 });
  const FEDE: Session = { memberId: otroId, role: "collaborator", name: "Fede", issuedAt: Date.now() };
  const mine = await submit(ctx, COLLAB, 1);
  const his = await submit(ctx, FEDE, 2);
  await analyzeRequest(ctx, his);
  assert.deepEqual((await visibleRequests(ctx, COLLAB)).map((r) => r.id), [mine]);
  assert.deepEqual((await visibleRequests(ctx, ORG)).map((r) => r.id).sort(), [mine, his].sort());
  assert.equal(await requestFor(ctx, COLLAB, his), null);
  assert.ok(await requestFor(ctx, FEDE, his));
  assert.ok(await requestFor(ctx, ORG, his));
  await assert.rejects(respondClarification(ctx, COLLAB, his, "es mío"), /No existe/);
  await respondClarification(ctx, FEDE, his, "fue un remís");
});

test("la vista previa no le muestra a un colaborador el número del gasto de otro", async () => {
  const ctx = await makeCtx();
  const otroId = await addMember(ctx, ORG, { email: "gabi@x.com", name: "Gabi", role: "collaborator", wallet: OTHER });
  await setAssignment(ctx, ORG, { budgetId: BUDGET_ID, memberId: otroId, categoryKey: null, amountCents: 100000 });
  await submit(ctx, { memberId: otroId, role: "collaborator", name: "Gabi", issuedAt: Date.now() }, 9);
  const r = await previewExpense(ctx, COLLAB, { bytes: tinyPng(9) });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.verdict, "review");
  assert.deepEqual(r.duplicateOf, []);
  assert.doesNotMatch(r.headline, /#/);
});

async function db_close(ctx: TestCtx) {
  await ctx.db.close();
}
