import test from "node:test";
import assert from "node:assert/strict";
import { parseArsToCents, centsToWei, formatArs, formatWars, centsToDecimalString, MoneyParseError } from "../lib/money.ts";

test("parsea formatos aceptados", () => {
  assert.equal(parseArsToCents("1.500,00"), 150000);
  assert.equal(parseArsToCents("1500.00"), 150000);
  assert.equal(parseArsToCents("$ 1.500"), 150000);
  assert.equal(parseArsToCents("$1.500,50"), 150050);
  assert.equal(parseArsToCents("1500"), 150000);
  assert.equal(parseArsToCents("1500,00"), 150000);
  assert.equal(parseArsToCents("ARS 1.234.567,89"), 123456789);
  assert.equal(parseArsToCents("1,500.00"), 150000);
  assert.equal(parseArsToCents("0.01"), 1);
});

test("rechaza ambiguos e inválidos", () => {
  for (const bad of ["1,5", "1.5", "1,500", "1.50.0", "-100", "", "abc", "1.500,5", "12.34.56,00", "1,500,00", "1e3"]) {
    assert.throws(() => parseArsToCents(bad), MoneyParseError, bad);
  }
});

test("centavos → wei exacto (× 10^16)", () => {
  assert.equal(centsToWei(150000), 1500n * 10n ** 18n);
  assert.equal(centsToWei(1), 10n ** 16n);
  assert.equal(centsToWei(0), 0n);
  assert.throws(() => centsToWei(1.5));
  assert.throws(() => centsToWei(-1));
});

test("formatos de salida", () => {
  assert.equal(formatArs(150000), "$ 1.500,00");
  assert.equal(formatArs(5), "$ 0,05");
  assert.equal(formatArs(123456789), "$ 1.234.567,89");
  assert.equal(formatWars(1500n * 10n ** 18n), "1.500,00 wARS");
  assert.equal(formatWars(1n), "0,000000000000000001 wARS");
  assert.equal(centsToDecimalString(150000), "1500.00");
});

test("sin floats: valores grandes siguen exactos", () => {
  const cents = parseArsToCents("90.071.992.547.409,91");
  assert.equal(cents, Number.MAX_SAFE_INTEGER);
  assert.equal(centsToWei(cents), 9007199254740991n * 10n ** 16n);
  assert.throws(() => parseArsToCents("90.071.992.547.409,92"));
});
