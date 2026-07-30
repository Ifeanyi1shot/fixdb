/**
 * Normalizes a raw error string so that the same underlying error,
 * seen across different environments (different resource names, IDs,
 * timestamps, paths), produces the same fingerprint for matching
 * against the knowledge base.
 */

const NORMALIZATION_RULES: Array<{ pattern: RegExp; replacement: string }> = [
  // UUIDs / GUIDs (subscription IDs, object IDs, etc.)
  { pattern: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, replacement: "<uuid>" },
  // IPv4 addresses
  { pattern: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, replacement: "<ip>" },
  // ISO-ish timestamps
  { pattern: /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?/g, replacement: "<timestamp>" },
  // Unix-style file paths
  { pattern: /\/[\w./-]+\.(tf|yaml|yml|json|log)/g, replacement: "<path>" },
  // Windows-style file paths
  { pattern: /[A-Za-z]:\\[\w\\.-]+/g, replacement: "<path>" },
  // Line/column references, e.g. "line 42" or ":42:7"
  { pattern: /\bline\s+\d+/gi, replacement: "line <n>" },
  { pattern: /:\d+:\d+/g, replacement: ":<n>:<n>" },
  // Quoted resource names (best-effort — keeps structure, drops the specific name)
  { pattern: /"[\w.-]{3,}"/g, replacement: '"<name>"' },
  // Long hex hashes (commit SHAs, image digests)
  { pattern: /\b[0-9a-f]{12,64}\b/gi, replacement: "<hash>" },
];

export function normalizeError(raw: string): string {
  let normalized = raw.trim();
  for (const rule of NORMALIZATION_RULES) {
    normalized = normalized.replace(rule.pattern, rule.replacement);
  }
  // Collapse whitespace so formatting differences don't affect matching
  return normalized.replace(/\s+/g, " ").toLowerCase();
}

/**
 * Produces a short fingerprint id (not cryptographically strong — just
 * a stable identifier for cache/dedupe purposes) from a normalized error.
 */
export function fingerprintId(normalized: string): string {
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash * 31 + normalized.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}
