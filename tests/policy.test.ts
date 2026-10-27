import test from "node:test";
import assert from "node:assert/strict";
import { evaluateChecks, checkOf, isArs } from "../lib/policy.ts";
import { DEMO_EVAL_POLICY } from "./helpers.ts";
import type { ReceiptFields } from "../lib/types.ts";
import { RECIPIENT } from "./helpers.ts";

const policy = DEMO_EVAL_POLICY;
const base: ReceiptFields = {
  date: "2026-10-15",
  merchant: "X",
  concept: "Y",
  amountCents: 150000,
  currency: "ARS",
  category: "transporte",
};
const run = (f: Partial<ReceiptFields>, recipient = RECIPIENT) =>
  evaluateChecks({ policy, fields: { ...base, ...f }, recipient, availableForRequestCents: 500000, duplicates: { file: [], data: [] } });

test("fecha: bordes del rango inclusivos", () => {
  assert.equal(checkOf(run({ date: "2026-10-10" }), "date_in_range")?.ok, true);
  assert.equal(checkOf(run({ date: "2026-10-18" }), "date_in_range")?.ok, true);
  assert.equal(checkOf(run({ date: "2026-10-09" }), "date_in_range")?.ok, false);
  assert.equal(checkOf(run({ date: "2026-10-19" }), "date_in_range")?.ok, false);
  assert.equal(checkOf(run({ date: null }), "date_in_range")?.ok, null);
  assert.equal(checkOf(run({ date: "2026-02-30" }), "date_in_range")?.ok, null);
});

test("tope: igual pasa, +1 centavo falla", () => {
  assert.equal(checkOf(run({ amountCents: 200000 }), "amount_le_cap")?.ok, true);
  assert.equal(checkOf(run({ amountCents: 200001 }), "amount_le_cap")?.ok, false);
  assert.equal(checkOf(run({ amountCents: null }), "amount_parsed")?.ok, null);
});

test("categoría", () => {
  assert.equal(checkOf(run({ category: "materiales" }), "category_allowed")?.ok, true);
  assert.equal(checkOf(run({ category: "otra" }), "category_allowed")?.ok, false);
  assert.equal(checkOf(run({ category: "indeterminada" }), "category_allowed")?.ok, null);
});

test("moneda", () => {
  assert.equal(checkOf(run({ currency: "ARS" }), "currency_is_ars")?.ok, true);
  assert.equal(checkOf(run({ currency: "ars" }), "currency_is_ars")?.ok, true);
  assert.equal(checkOf(run({ currency: "USD" }), "currency_is_ars")?.ok, false);
  assert.equal(checkOf(run({ currency: null }), "currency_is_ars")?.ok, null);
  assert.equal(isArs("$"), true);
});

test("destinatario: checksum inválido falla", () => {
  assert.equal(checkOf(run({}, "0x52908400098527886E0F7030069857D2E4169EE7"), "recipient_valid")?.ok, true);
  assert.equal(checkOf(run({}, "0x52908400098527886e0F7030069857D2E4169EE7"), "recipient_valid")?.ok, false);
  assert.equal(checkOf(run({}, "0x123"), "recipient_valid")?.ok, false);
});

test("presupuesto", () => {
  const c = evaluateChecks({ policy, fields: base, recipient: RECIPIENT, availableForRequestCents: 149999, duplicates: { file: [], data: [] } });
  assert.equal(checkOf(c, "budget_available")?.ok, false);
});
