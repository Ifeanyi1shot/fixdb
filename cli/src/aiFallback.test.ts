import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDiagnosisResponse } from "./aiFallback";

test("parseDiagnosisResponse parses a well-formed diagnosis", () => {
  const result = parseDiagnosisResponse('{"cause": "test cause", "fix": "test fix"}');
  assert.deepEqual(result, { cause: "test cause", fix: "test fix", confirmed: false });
});

test("parseDiagnosisResponse falls back when a required field is missing", () => {
  const result = parseDiagnosisResponse('{"cause": "only a cause"}');
  assert.equal(result.confirmed, false);
  assert.match(result.cause, /unable to parse/i);
});

test("parseDiagnosisResponse falls back on non-JSON text instead of throwing", () => {
  const result = parseDiagnosisResponse("the model rambled instead of returning JSON");
  assert.equal(result.confirmed, false);
  assert.match(result.cause, /unable to parse/i);
});

test("parseDiagnosisResponse tolerates surrounding whitespace", () => {
  const result = parseDiagnosisResponse('\n  {"cause": "c", "fix": "f"}  \n');
  assert.deepEqual(result, { cause: "c", fix: "f", confirmed: false });
});
