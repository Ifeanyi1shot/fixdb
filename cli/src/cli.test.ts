import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const CLI_PATH = path.join(__dirname, "..", "dist", "index.js");

function runCli(args: string[], envOverrides: Record<string, string | undefined> = {}) {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "fixdb-cli-test-"));
  const env: Record<string, string | undefined> = {
    ...process.env,
    USERPROFILE: fakeHome,
    HOME: fakeHome,
    ...envOverrides,
  };
  delete env.ANTHROPIC_API_KEY;
  if (envOverrides.ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = envOverrides.ANTHROPIC_API_KEY;

  const result = spawnSync(process.execPath, [CLI_PATH, ...args], { env, encoding: "utf8" });
  fs.rmSync(fakeHome, { recursive: true, force: true });
  return result;
}

test("cli requires a build before these tests run", () => {
  assert.ok(fs.existsSync(CLI_PATH), `${CLI_PATH} is missing — run \`npm run build\` first`);
});

test("scan finds a known match and exits 0", () => {
  const result = runCli(["scan", "--tool", "kubernetes", "Pod app-7d9f CrashLoopBackOff, container exited"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Match found: Pod stuck in CrashLoopBackOff/);
});

test("scan with no match and no ANTHROPIC_API_KEY reports a miss without crashing", () => {
  const result = runCli(["scan", "--tool", "kubernetes", "some totally made up error xyz123"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /No known match in the local knowledge base/);
  assert.match(result.stdout, /fixdb contribute/);
});

test("contribute without --title fails clearly instead of writing a bad draft", () => {
  const result = runCli(["contribute", "some error", "--tool", "kubernetes"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--title is required/);
});

test("contribute with an unknown tool fails clearly", () => {
  const result = runCli(["contribute", "some error", "--tool", "not-a-real-tool", "--title", "x"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must be one of/);
});

test("update against an unreachable repo fails gracefully instead of crashing", () => {
  const result = runCli(["update", "--repo", "this-org-does-not-exist-xyz/nope"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Could not sync knowledge base/);
});
