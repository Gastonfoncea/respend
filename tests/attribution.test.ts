import test from "node:test";
import assert from "node:assert/strict";
import { codeFromRepo, fromDataSuffix } from "@celo/attribution-tags";
import { withAttribution, attributionSuffix, hasOurAttribution } from "../lib/chain/attribution.ts";
import { encodeTransfer } from "../lib/chain/token.ts";
import { ATTRIBUTION_CODE } from "../lib/config.ts";

test("codeFromRepo del repo coincide con el código configurado", () => {
  assert.equal(codeFromRepo("gastonfoncea/respend"), "celo_e418a350ffec");
  assert.equal(ATTRIBUTION_CODE, "celo_e418a350ffec");
});

test("el calldata termina con el sufijo y fromDataSuffix lo decodifica", () => {
  const transfer = encodeTransfer("0x1111111111111111111111111111111111111111", 15n * 10n ** 20n);
  const data = withAttribution(transfer);
  assert.ok(data.startsWith(transfer));
  assert.ok(data.endsWith(attributionSuffix().slice(2)));
  assert.deepEqual(fromDataSuffix(data)?.codes, ["celo_e418a350ffec"]);
  assert.equal(hasOurAttribution(data), true);
  assert.equal(hasOurAttribution(transfer), false);
});
