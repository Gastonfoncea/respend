// Postgres (PGlite): migraciones, barreras de la base contra pagos dobles y lock de escritura.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { openPglite, parseInt8 } from "../lib/db.ts";
import * as repo from "../lib/repo.ts";
import { DEMO_POLICY } from "../lib/demo.ts";
import { tmpDir } from "./helpers.ts";
import { authorizedRequest } from "./payments-helpers.ts";

test("migraciones: una base en disco se reabre sin re-aplicarlas y conserva los datos", async () => {
  const dir = path.join(tmpDir(), "pglite");
  const a = await openPglite(dir);
  await repo.upsertEvent(a, DEMO_POLICY);
  await repo.setAutoPayLimitCents(a, 5000);
  await a.close();
  const b = await openPglite(dir);
  assert.equal(await repo.getAutoPayLimitCents(b), 5000);
  assert.equal((await repo.getPolicy(b)).version, 1);
  await b.close();
});

test("BIGINT vuelve como number entero; fuera del rango seguro, falla en vez de redondear", async () => {
  const db = await openPglite();
  await repo.upsertEvent(db, { ...DEMO_POLICY, budgetCents: 900_000_000_000 });
  assert.equal((await repo.getPolicy(db)).budgetCents, 900_000_000_000);
  assert.throws(() => parseInt8("9007199254740993"));
  await db.close();
});

test("la base rechaza un segundo pago vivo de la misma solicitud aunque el código no lo chequee", async () => {
  const { ctx, id } = await authorizedRequest();
  const auth = (await repo.getActiveAuthorization(ctx.db, id))!;
  await repo.insertPayment(ctx.db, { requestId: id, authorizationId: auth.id, mode: "simulated", fromAddress: null });
  await assert.rejects(
    repo.insertPayment(ctx.db, { requestId: id, authorizationId: auth.id, mode: "simulated", fromAddress: null }),
    /one_live_payment_per_request|one_payment_in_flight/,
  );
});

test("bloqueo global en la base: dos pagos en curso de solicitudes distintas no pueden coexistir", async () => {
  const { ctx, id } = await authorizedRequest(1);
  const auth = (await repo.getActiveAuthorization(ctx.db, id))!;
  const now = new Date().toISOString();
  // Otra solicitud con su autorización, insertadas a mano para saltear los chequeos del código.
  const [{ id: other }] = await ctx.db.query<{ id: number }>(
    `INSERT INTO requests (created_at, updated_at, description, recipient, file_path, file_sha256, mime, status)
     VALUES ($1, $1, 'otra', $2, 'x.png', 'x', 'image/png', 'authorized') RETURNING id`,
    [now, auth.recipient],
  );
  const otherAuth = await repo.insertAuthorization(ctx.db, { ...auth, request_id: other, binding_hash: "otro" });
  await repo.insertPayment(ctx.db, { requestId: id, authorizationId: auth.id, mode: "mainnet", fromAddress: null });
  await assert.rejects(
    repo.insertPayment(ctx.db, { requestId: other, authorizationId: otherAuth, mode: "mainnet", fromAddress: null }),
    /one_payment_in_flight/,
  );
});

test("tx(): dos transacciones no se intercalan (lock de escritura)", async () => {
  const db = await openPglite();
  const order: string[] = [];
  await Promise.all([
    db.tx(async (q) => {
      order.push("a:start");
      await q.query("SELECT 1");
      await new Promise((r) => setTimeout(r, 30));
      order.push("a:end");
    }),
    db.tx(async () => {
      order.push("b:start");
      order.push("b:end");
    }),
  ]);
  assert.deepEqual(order, ["a:start", "a:end", "b:start", "b:end"]);
  await db.close();
});

test("tx(): si algo falla adentro, no queda nada escrito", async () => {
  const db = await openPglite();
  await repo.upsertEvent(db, DEMO_POLICY);
  await assert.rejects(
    db.tx(async (q) => {
      await repo.setAutoPayLimitCents(q, 1);
      throw new Error("boom");
    }),
    /boom/,
  );
  assert.equal(await repo.getAutoPayLimitCents(db), 10000);
  await db.close();
});
