import test from "node:test";
import assert from "node:assert/strict";
import { agentDigest } from "../lib/digest.ts";
import type { RequestRow } from "../lib/types.ts";

let id = 0;
const req = (status: RequestRow["status"], recommendation: RequestRow["recommendation"] = null, dup = false) =>
  ({
    id: ++id,
    status,
    recommendation,
    duplicate_flags: JSON.stringify({ file: dup ? [1] : [], data: [] }),
  }) as unknown as RequestRow;

test("sin gastos abiertos: todo al día", () => {
  const d = agentDigest([req("reimbursed", "approve"), req("rejected", "reject")]);
  assert.equal(d.sentence, "Todo al día: no hay gastos pendientes.");
  assert.equal(d.focus, "idle");
});

test("clasifica cada gasto abierto y arma la frase", () => {
  const d = agentDigest([
    req("analyzed", "approve"),
    req("analyzed", "flag_review", true),
    req("analyzed", "flag_review"),
    req("needs_info", "needs_info"),
    req("reimbursed", "approve"),
  ]);
  assert.deepEqual(
    { ...d.counts },
    { open: 4, ready: 1, review: 1, duplicates: 1, outside: 0, waiting: 1, analyzing: 0, paying: 0 },
  );
  assert.equal(
    d.sentence,
    "Revisé 4 gastos abiertos: 1 listo para pagar, 1 necesita tu ojo, 1 parece duplicado y 1 espera respuesta del colaborador.",
  );
  assert.equal(d.focus, "review");
});

test("solo pagables: foco en pagar; plurales correctos", () => {
  const d = agentDigest([req("analyzed", "approve"), req("analyzed", "approve")]);
  assert.equal(d.sentence, "Revisé 2 gastos abiertos: 2 listos para pagar.");
  assert.equal(d.focus, "ready");
});

test("pagos inciertos o fallidos piden atención del organizador", () => {
  const d = agentDigest([req("payment_uncertain", "approve"), req("authorized", "approve")]);
  assert.equal(d.counts.review, 1);
  assert.equal(d.counts.paying, 1);
});

test("cuenta lo que el agente pagó solo hoy y avisa al llegar al tope", () => {
  const base = { limitCents: 10000, capCents: 30000 };
  assert.equal(
    agentDigest([req("analyzed", "approve")], { ...base, count: 2, cents: 20000 }).sentence,
    "Hoy pagué solo 2 gastos ($ 200 de $ 300 del tope). Revisé 1 gasto abierto: 1 listo para pagar.",
  );
  assert.equal(
    agentDigest([], { ...base, count: 3, cents: 30000 }).sentence,
    "Hoy pagué solo 3 gastos ($ 300 de $ 300 del tope). Llegué al tope: lo que sigue te espera. Todo al día: no hay gastos pendientes.",
  );
  // Apagado o sin pagos hoy: no agrega nada.
  assert.equal(agentDigest([], { ...base, limitCents: 0, count: 0, cents: 0 }).sentence, "Todo al día: no hay gastos pendientes.");
  assert.equal(agentDigest([], { ...base, count: 0, cents: 0 }).sentence, "Todo al día: no hay gastos pendientes.");
});
