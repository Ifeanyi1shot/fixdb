import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  loadKnowledgeBase,
  matchError,
  resolveKbDir,
  getBundledKbDir,
  syncKnowledgeBase,
  KnowledgeBaseEntry,
} from "./knowledgeBase";

function makeEntry(overrides: Partial<KnowledgeBaseEntry>): KnowledgeBaseEntry {
  return {
    id: "test-entry",
    tool: "kubernetes",
    signature: "some pattern",
    title: "Test entry",
    cause: "cause",
    fix: "fix",
    ...overrides,
  };
}

test("matchError finds a case-insensitive regex match after normalization", () => {
  const entries = [makeEntry({ signature: "crashloopbackoff" })];
  const results = matchError("Pod app-7d9f CrashLoopBackOff, container exited", entries);
  assert.equal(results.length, 1);
  assert.equal(results[0].entry.id, "test-entry");
});

test("matchError returns no results when nothing matches", () => {
  const entries = [makeEntry({ signature: "crashloopbackoff" })];
  assert.equal(matchError("totally unrelated error text", entries).length, 0);
});

test("matchError respects an explicit tool filter", () => {
  const entries = [
    makeEntry({ id: "k8s-entry", tool: "kubernetes", signature: "boom" }),
    makeEntry({ id: "tf-entry", tool: "terraform", signature: "boom" }),
  ];
  const results = matchError("boom", entries, "terraform");
  assert.equal(results.length, 1);
  assert.equal(results[0].entry.id, "tf-entry");
});

test("matchError sorts multiple matches by confirmed_by, highest first", () => {
  const entries = [
    makeEntry({ id: "low", signature: "boom", confirmed_by: 1 }),
    makeEntry({ id: "high", signature: "boom", confirmed_by: 9 }),
  ];
  const results = matchError("boom", entries);
  assert.deepEqual(
    results.map((r) => r.entry.id),
    ["high", "low"]
  );
});

test("matchError skips entries with an invalid regex instead of throwing", () => {
  const entries = [
    makeEntry({ id: "broken", signature: "(unclosed" }),
    makeEntry({ id: "fine", signature: "boom" }),
  ];
  const results = matchError("boom", entries);
  assert.deepEqual(
    results.map((r) => r.entry.id),
    ["fine"]
  );
});

test("loadKnowledgeBase recursively loads valid YAML entries and skips the rest", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fixdb-kb-"));
  try {
    fs.mkdirSync(path.join(tmpDir, "terraform"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "terraform", "a.yaml"),
      "id: a\ntool: terraform\nsignature: foo\ntitle: A\ncause: c\nfix: f\n"
    );
    // Missing required fields (no signature) — should be skipped.
    fs.writeFileSync(path.join(tmpDir, "terraform", "incomplete.yaml"), "id: incomplete\ntool: terraform\n");
    // Not a YAML file — should be ignored entirely.
    fs.writeFileSync(path.join(tmpDir, "terraform", "notes.txt"), "id: nope\nsignature: nope\n");

    const entries = loadKnowledgeBase(tmpDir);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].id, "a");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("getBundledKbDir points at a directory that actually contains the seed entries", () => {
  const dir = getBundledKbDir();
  assert.ok(fs.existsSync(path.join(dir, "kubernetes", "crashloopbackoff-oom.yaml")));
});

test("resolveKbDir returns an explicit path verbatim without touching it", () => {
  assert.equal(resolveKbDir("/some/explicit/path"), "/some/explicit/path");
});

test("resolveKbDir seeds a per-user cache from the bundled snapshot on first use", () => {
  const originalUserProfile = process.env.USERPROFILE;
  const originalHome = process.env.HOME;
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "fixdb-fakehome-"));
  process.env.USERPROFILE = fakeHome;
  process.env.HOME = fakeHome;
  try {
    const kbDir = resolveKbDir();
    assert.ok(kbDir.startsWith(fakeHome));
    assert.ok(fs.existsSync(path.join(kbDir, "kubernetes", "crashloopbackoff-oom.yaml")));
  } finally {
    process.env.USERPROFILE = originalUserProfile;
    process.env.HOME = originalHome;
    fs.rmSync(fakeHome, { recursive: true, force: true });
  }
});

test("syncKnowledgeBase writes fetched entries into the cache dir and returns the count", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fixdb-sync-"));
  const originalFetch = globalThis.fetch;
  t.mock.method(
    globalThis,
    "fetch",
    (async (url: string) => {
      if (url.includes("api.github.com")) {
        return {
          ok: true,
          json: async () => ({
            tree: [
              { path: "knowledge-base/terraform/new.yaml", type: "blob" },
              { path: "README.md", type: "blob" }, // not under knowledge-base/ — must be ignored
            ],
          }),
        } as Response;
      }
      return { ok: true, text: async () => "id: new\nsignature: x\n" } as Response;
    }) as typeof fetch
  );
  try {
    const count = await syncKnowledgeBase("someone/fixdb", "main", tmpDir);
    assert.equal(count, 1);
    assert.equal(
      fs.readFileSync(path.join(tmpDir, "terraform", "new.yaml"), "utf8"),
      "id: new\nsignature: x\n"
    );
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("syncKnowledgeBase throws on a failed listing instead of silently returning nothing", async (t) => {
  const originalFetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", (async () => ({ ok: false, status: 404 }) as Response) as typeof fetch);
  try {
    await assert.rejects(() => syncKnowledgeBase("nobody/nothing", "main", os.tmpdir()));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
