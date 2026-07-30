import fs from "fs";
import os from "os";
import path from "path";
import yaml from "js-yaml";
import { normalizeError } from "./fingerprint";

export interface KnowledgeBaseEntry {
  id: string;
  tool: "terraform" | "kubernetes" | "github-actions";
  provider?: string;
  signature: string; // regex pattern, matched against the normalized error
  title: string;
  cause: string;
  fix: string;
  tags?: string[];
  confirmed_by?: number;
}

export interface MatchResult {
  entry: KnowledgeBaseEntry;
  confidence: "high" | "medium";
}

/**
 * Loads every YAML entry under the knowledge-base directory.
 * In v1 this reads from a local checkout; a later version can
 * sync this directory from GitHub on a schedule (see PRD FR-4).
 */
export function loadKnowledgeBase(kbRoot: string): KnowledgeBaseEntry[] {
  const entries: KnowledgeBaseEntry[] = [];

  function walk(dir: string) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory()) {
        walk(fullPath);
      } else if (item.name.endsWith(".yaml") || item.name.endsWith(".yml")) {
        const raw = fs.readFileSync(fullPath, "utf8");
        const parsed = yaml.load(raw) as KnowledgeBaseEntry;
        if (parsed?.id && parsed?.signature) {
          entries.push(parsed);
        }
      }
    }
  }

  walk(kbRoot);
  return entries;
}

/**
 * Matches a raw error string against the loaded knowledge base.
 * Returns matches ordered by confidence, best first.
 */
export function matchError(
  rawError: string,
  entries: KnowledgeBaseEntry[],
  toolFilter?: string
): MatchResult[] {
  const normalized = normalizeError(rawError);
  const candidates = toolFilter
    ? entries.filter((e) => e.tool === toolFilter)
    : entries;

  const results: MatchResult[] = [];
  for (const entry of candidates) {
    try {
      const pattern = new RegExp(entry.signature, "i");
      if (pattern.test(normalized)) {
        results.push({ entry, confidence: "high" });
      }
    } catch {
      // Skip entries with invalid regex signatures rather than crashing the scan
      continue;
    }
  }

  return results.sort(
    (a, b) => (b.entry.confirmed_by ?? 0) - (a.entry.confirmed_by ?? 0)
  );
}

/**
 * The knowledge base snapshot shipped inside the package. After `npm run
 * build` (or in a published npm package) this is dist/knowledge-base,
 * copied there by scripts/copy-kb.js. Falls back to the monorepo checkout
 * location so `npm run dev` (ts-node running from src/) keeps working
 * without requiring a build first.
 */
export function getBundledKbDir(): string {
  const packaged = path.join(__dirname, "knowledge-base");
  if (fs.existsSync(packaged)) return packaged;
  return path.join(__dirname, "..", "..", "knowledge-base");
}

/** Per-user writable cache, independent of how/where the package is installed. */
export function getCacheKbDir(): string {
  return path.join(os.homedir(), ".fixdb", "knowledge-base");
}

/**
 * Resolves the directory to load knowledge base entries from.
 * - An explicit path (e.g. --kb) is used as-is.
 * - Otherwise, the per-user cache is seeded from the bundled snapshot on
 *   first use (no network access) and returned, so matching works fully
 *   offline immediately after install (FR-3/FR-10).
 */
export function resolveKbDir(explicitPath?: string): string {
  if (explicitPath) return explicitPath;

  const cacheDir = getCacheKbDir();
  if (!fs.existsSync(cacheDir)) {
    fs.cpSync(getBundledKbDir(), cacheDir, { recursive: true });
  }
  return cacheDir;
}

/**
 * Syncs the knowledge base cache from a GitHub repo using the git trees API
 * + raw.githubusercontent.com (no extra dependency needed, Node's global
 * fetch is sufficient). Throws on network/HTTP failure; callers are
 * responsible for falling back to the last-cached copy (NFR: sync failures
 * must never block a scan).
 */
export async function syncKnowledgeBase(
  repo: string,
  ref: string,
  cacheDir: string
): Promise<number> {
  const treeRes = await fetch(
    `https://api.github.com/repos/${repo}/git/trees/${ref}?recursive=1`
  );
  if (!treeRes.ok) {
    throw new Error(`Failed to list ${repo}@${ref}: HTTP ${treeRes.status}`);
  }
  const tree = (await treeRes.json()) as { tree: Array<{ path: string; type: string }> };
  const kbFiles = tree.tree.filter(
    (item) => item.type === "blob" && item.path.startsWith("knowledge-base/") && /\.ya?ml$/i.test(item.path)
  );

  for (const file of kbFiles) {
    const rawRes = await fetch(`https://raw.githubusercontent.com/${repo}/${ref}/${file.path}`);
    if (!rawRes.ok) {
      throw new Error(`Failed to fetch ${file.path}: HTTP ${rawRes.status}`);
    }
    const content = await rawRes.text();
    const relativePath = file.path.slice("knowledge-base/".length);
    const destPath = path.join(cacheDir, relativePath);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, content, "utf8");
  }

  return kbFiles.length;
}
