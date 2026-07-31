import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeError, fingerprintId } from "./fingerprint";

test("normalizeError strips UUIDs", () => {
  const result = normalizeError("resource 4f3a1c2e-9b7d-4e21-8a5f-1c2d3e4f5a6b not found");
  assert.equal(result, "resource <uuid> not found");
});

test("normalizeError strips IPv4 addresses", () => {
  assert.equal(normalizeError("dial tcp 10.0.0.5:443: connect timeout"), "dial tcp <ip>:443: connect timeout");
});

test("normalizeError strips ISO timestamps", () => {
  assert.equal(
    normalizeError("lock created at 2026-07-30T03:41:12.884213Z"),
    "lock created at <timestamp>"
  );
});

test("normalizeError strips unix and windows file paths", () => {
  assert.equal(normalizeError("error in /home/user/main.tf"), "error in <path>");
  assert.equal(normalizeError("error in C:\\Users\\dev\\main.tf"), "error in <path>");
});

test("normalizeError strips line/column references", () => {
  assert.equal(normalizeError("syntax error at line 42"), "syntax error at line <n>");
  assert.equal(normalizeError("main.go:42:7: undefined"), "main.go:<n>:<n>: undefined");
});

test("normalizeError strips long hex hashes", () => {
  assert.equal(
    normalizeError("image sha256:abcdef0123456789abcdef0123456789abcdef01"),
    "image sha256:<hash>"
  );
});

test("normalizeError collapses whitespace and lowercases", () => {
  assert.equal(normalizeError("Error:    Something   BROKE\n\nhere"), "error: something broke here");
});

test("normalizeError produces the same fingerprint across differing environments", () => {
  const a = normalizeError("Error acquiring lock 8f2a1c3d-9b4e-4f7a-8c1d-3e5b6a7f9d2e at 2026-07-30T03:41:12Z");
  const b = normalizeError("Error acquiring lock 11111111-2222-3333-4444-555555555555 at 2026-08-01T10:00:00Z");
  assert.equal(a, b);
});

test("fingerprintId is stable for identical input", () => {
  const normalized = normalizeError("some error text");
  assert.equal(fingerprintId(normalized), fingerprintId(normalized));
});

test("fingerprintId differs for different input", () => {
  assert.notEqual(fingerprintId(normalizeError("error a")), fingerprintId(normalizeError("error b")));
});
