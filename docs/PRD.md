# Product Requirements Document: fixdb

**A shared, open-source knowledge base and CLI for diagnosing DevOps and infrastructure errors**

| | |
|---|---|
| **Author** | Patrick Olayinka |
| **Status** | Draft v1.0 |
| **Date** | July 2026 |
| **Target license** | MIT (fully open source) |

---

## 1. Problem Statement

Every DevOps engineer, at every skill level, regularly hits cryptic errors from Terraform, Kubernetes, CI/CD pipelines, and cloud CLIs. In almost every case, someone else has already hit and solved that exact error — but that knowledge lives scattered across Stack Overflow threads, GitHub issues, Medium posts, internal Slack channels, and individual engineers' memories. There is no shared, structured, searchable knowledge base built specifically for infrastructure error diagnosis.

The result: engineers repeatedly re-solve the same problems from scratch, losing hours to errors that took someone else five minutes to fix a year ago. Existing tools (Checkov, tfsec, OPA, Sentinel) check whether code complies with policy *before* it runs — none of them help you understand *why something failed after it ran*, in plain language, with a confirmed fix.

## 2. Goal

Build an open-source tool that:
1. Takes a raw error (pasted, or read from a log/CI output) from a supported DevOps tool.
2. Matches it against a shared, community-maintained knowledge base of known errors and confirmed fixes.
3. Returns a plain-language diagnosis and fix in seconds.
4. When no match exists, uses AI to produce a best-guess diagnosis, and turns a confirmed answer into a new knowledge base entry — so the base grows every time someone hits something new.

## 3. Non-Goals (v1)

- Not a policy/compliance scanner (Checkov, tfsec, OPA already do this well — no need to compete).
- Not a drift-detection or remediation-execution tool (that's a different product; see Kestrel, Firefly, env0).
- Not a hosted SaaS in v1 — this ships as an open-source CLI + public knowledge base repo, no backend infrastructure to run or pay for.
- Not scoped to every tool in the DevOps universe at launch — v1 covers three tools deliberately (see Section 6).

## 4. Target Users

- **Primary:** Individual DevOps/platform/SRE engineers debugging failures in their terminal or CI pipeline.
- **Secondary:** Teams who want failed CI runs to surface a plain-language diagnosis automatically via a GitHub Action, without a human digging through logs first.
- **Tertiary:** Open-source contributors who want to document a fix they discovered so others benefit.

## 5. Core User Stories

1. *As an engineer*, when my `terraform apply` fails, I want to run one command against the log and get a plain-language cause and fix, so I don't have to Google the exact error text.
2. *As an engineer*, when I hit an error nobody's documented yet, I want the tool to give me an AI best-guess diagnosis rather than nothing, so I'm not stuck.
3. *As a contributor*, once I've solved a new error, I want an easy way to submit it back to the shared knowledge base, so the next person benefits.
4. *As a team lead*, I want failed GitHub Actions workflow runs to automatically get a diagnosis comment, so my team spends less time triaging CI failures.

## 6. Scope for v1 (Launch)

**Supported tools (deliberately narrow to ship fast):**
- Terraform (`azurerm` and `azapi` providers)
- Kubernetes (pod/container failure states — `CrashLoopBackOff`, `ImagePullBackOff`, OOMKilled, etc.)
- GitHub Actions (workflow-level failures: auth, permissions, runner/environment issues)

**In scope:**
- CLI tool (`fixdb scan <log-file>` / `fixdb scan --tool <tool> "<error text>"`)
- Public knowledge base as versioned YAML files in a GitHub repo
- Error fingerprinting/normalization logic (strip variable data like UUIDs, timestamps, paths before matching)
- AI fallback diagnosis via Claude API when no match is found
- GitHub Action wrapper that posts a diagnosis comment on failed workflow runs
- Contribution workflow via standard GitHub pull requests

**Out of scope for v1:**
- Web UI / hosted dashboard
- Support for AWS/GCP-specific Terraform providers, Docker Compose, Jenkins, Ansible (candidates for v2+)
- Auto-remediation (running the fix automatically) — v1 only diagnoses, never acts
- Team/org-specific private knowledge bases (v1 is one shared public base only)

## 7. Functional Requirements

| ID | Requirement |
|----|---|
| FR-1 | CLI accepts a log file path or a raw error string as input |
| FR-2 | CLI normalizes/fingerprints the error (strips UUIDs, IPs, timestamps, file paths, line numbers) |
| FR-3 | CLI matches the fingerprint against the local cached copy of the knowledge base |
| FR-4 | CLI syncs the latest knowledge base from GitHub on a configurable interval (default: once per day, or on demand via `fixdb update`) |
| FR-5 | On match, CLI displays: title, root cause, fix (with exact commands where applicable), and confidence/source count |
| FR-6 | On no match, CLI calls the Claude API with the error + surrounding log context and returns a best-guess diagnosis, clearly labeled as unconfirmed |
| FR-7 | CLI offers to save a confirmed fix as a new knowledge base entry, generating a draft YAML file the user can PR |
| FR-8 | GitHub Action wraps the CLI, runs on workflow failure, and posts the diagnosis as a PR/run comment |
| FR-9 | Knowledge base entries follow a fixed YAML schema (see Section 9) and are validated by CI on every PR to the knowledge base repo |
| FR-10 | All matching logic works fully offline once the knowledge base is cached locally — only the AI fallback requires network access |

## 8. Non-Functional Requirements

- **Performance:** local match lookup returns in under 1 second for a knowledge base of up to 10,000 entries.
- **Reliability:** knowledge base sync failures must never block a scan — CLI falls back to last-cached copy.
- **Security:** no error logs or user data are transmitted anywhere except directly to the Claude API for the AI-fallback path, and only when that path is triggered.
- **Maintainability:** knowledge base entries are plain YAML, human-readable, and diffable in a standard PR review.
- **Licensing:** MIT license on both the CLI and the knowledge base repo to maximize contribution and adoption.

## 9. Knowledge Base Entry Schema

```yaml
id: string                # unique slug, e.g. tf-azurerm-403-provider-registration
tool: string               # terraform | kubernetes | github-actions
provider: string           # optional, e.g. azurerm, azapi
signature: string           # regex pattern used for matching, post-normalization
title: string               # short human-readable summary
cause: string               # plain-language explanation of root cause
fix: string                 # plain-language fix, including exact commands where relevant
tags: [string]              # freeform tags for search/filtering
confirmed_by: integer        # count of users who confirmed this entry resolved their issue
```

## 10. Success Metrics (first 6 months)

- 300+ GitHub stars on the CLI repo
- 50+ community-contributed knowledge base entries beyond the initial seed set
- 20+ external contributors (PRs merged from people other than the author)
- CLI published and installable via npm with working GitHub Action listed in the GitHub Marketplace
- At least 3 unsolicited mentions/write-ups from the DevOps community (blog posts, Reddit, dev.to, etc.)

## 11. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Knowledge base stays empty / no community contributions | Seed with 30-50 real entries at launch from the author's own recent troubleshooting history before public release |
| Fingerprinting is too brittle and misses real matches | Start with straightforward regex normalization; treat matching quality as an ongoing iteration area, not a one-time build |
| AI fallback gives wrong diagnoses that get merged into the knowledge base unverified | Require a human `confirmed: true` flag before AI-generated entries are accepted via PR review, never auto-merge |
| Scope creep into supporting every DevOps tool at once | Hard cap v1 to 3 tools; treat additional tool support as v2 roadmap items gated by community demand |

## 12. Roadmap (Post-v1)

- v1.1: fuzzy/embeddings-based matching to catch near-miss errors regex can't
- v1.2: additional tool support based on community request volume (candidates: AWS/GCP Terraform providers, Docker, Ansible)
- v2: optional private/org-specific knowledge base overlay for internal-only errors (e.g. Project Skyline-specific `azapi` quirks) that sit on top of the public base without being published publicly
- v2: simple web search UI over the public knowledge base for people who don't want to install a CLI

## 13. Open Questions

- Should the knowledge base repo be a separate GitHub org from day one, to signal it's a community project rather than a personal repo?
- What's the right default behavior when an AI fallback diagnosis is wrong — should the CLI ask "did this help?" and log negative feedback anywhere?
- Is npm the right primary distribution channel, or should a standalone binary (via `pkg` or similar) be offered too for users without Node.js installed?
