import test from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionData, decodeFunctionData } from "viem";
import { IDENTITY_REGISTRY_ABI, buildRegistration, fromDataUri, toDataUri, agentScanUrl } from "../lib/erc8004.ts";

test("archivo de registro ERC-8004: campos y data URI ida y vuelta", () => {
  const reg = buildRegistration();
  assert.equal(reg.type, "https://eips.ethereum.org/EIPS/eip-8004#registration-v1");
  assert.deepEqual(reg.services, [{ name: "web", endpoint: "https://github.com/gastonfoncea/respend" }]);
  assert.equal(reg.active, true);
  assert.deepEqual(reg.supportedTrust, ["reputation"]);
  const uri = toDataUri(reg);
  assert.ok(uri.startsWith("data:application/json;base64,"));
  assert.deepEqual(fromDataUri(uri), reg);
});

test("calldata de register(agentURI) se codifica y decodifica offline", () => {
  const uri = toDataUri(buildRegistration());
  const data = encodeFunctionData({ abi: IDENTITY_REGISTRY_ABI, functionName: "register", args: [uri] });
  const back = decodeFunctionData({ abi: IDENTITY_REGISTRY_ABI, data });
  assert.equal(back.functionName, "register");
  assert.equal(back.args[0], uri);
  assert.equal(agentScanUrl(17n), "https://www.8004scan.io/agents/celo/17");
});
