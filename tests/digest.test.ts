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
