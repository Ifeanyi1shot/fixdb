# fixdb

A shared, open-source knowledge base and CLI for diagnosing DevOps and infrastructure errors — Terraform, Kubernetes, and GitHub Actions to start.

Stop re-solving the same infrastructure errors from scratch. When you hit a cryptic failure, `fixdb` matches it against a growing, community-maintained database of known errors and confirmed fixes. If nobody's seen it yet, it gives you an AI best-guess diagnosis — and helps you turn the confirmed fix into a new entry so the next person gets it instantly.

## Quick start

```bash
npm install -g fixdb
fixdb scan terraform-apply.log
fixdb scan --tool kubernetes "CrashLoopBackOff"
```

The install ships with a bundled snapshot of the [knowledge base](./knowledge-base), seeded into `~/.fixdb/knowledge-base` on first use — matching works fully offline right away. Run `fixdb update` at any time to pull the latest entries from GitHub into that cache (defaults to this repo; point it elsewhere with `--repo <owner/repo> --ref <branch>`). Sync failures never block a scan — the CLI just falls back to the last-cached copy.

Not published to npm yet? Build and run from source instead:

```bash
git clone https://github.com/Ifeanyi1shot/fixdb.git
cd fixdb/cli
npm install
npm run build
npm link          # makes the `fixdb` command available globally, pointing at this checkout
```

## How it works

1. **Fingerprint** — the raw error is normalized (UUIDs, IPs, timestamps, paths stripped out) so the same error from different environments matches the same entry.
2. **Match** — the fingerprint is checked against the local `~/.fixdb` cache of the [knowledge base](./knowledge-base).
3. **Diagnose** — on a match, you get a plain-language cause + fix. On no match, Claude gives a best-guess diagnosis, clearly labeled unconfirmed.
4. **Contribute** — confirmed fixes can be saved as a draft entry and submitted as a pull request, growing the knowledge base for everyone.

See [docs/PRD.md](./docs/PRD.md) for the full product spec.

## GitHub Action

Wraps the CLI and posts a diagnosis comment on failed workflow runs:

```yaml
- uses: Ifeanyi1shot/fixdb@v1
  with:
    log-path: build.log
    tool: terraform
```

## Project structure

```
fixdb/
├── cli/                  # the fixdb CLI (Node.js/TypeScript)
├── knowledge-base/        # community-maintained YAML error entries
│   ├── terraform/
│   ├── kubernetes/
│   └── github-actions/
├── action.yml             # the reusable GitHub Action (composite action)
├── .github/workflows/     # CI (knowledge base entry validation)
└── docs/
    └── PRD.md
```

## Contributing

Found a fix that isn't in the knowledge base yet? After a `fixdb scan` comes up empty, solve it yourself (or confirm the AI's best guess worked), then run:

```bash
fixdb contribute --title "Pod stuck in ImagePullBackOff from a private registry"
```

This drafts a YAML file (in `./fixdb-contributions/` by default) using the tool, error text, and AI diagnosis from your last scan — you only need to supply `--title`, or `--cause`/`--fix` if you're overriding the AI's guess. Review the draft (especially the auto-generated `signature` regex — it's a narrow starting point, not a final pattern), then copy it into `knowledge-base/<tool>/` in your fork and open a PR. You can also skip straight to it without a prior scan: `fixdb contribute "<error text>" --tool kubernetes --title "..." --cause "..." --fix "..."`.

The full field-by-field schema is documented in `docs/PRD.md#9-knowledge-base-entry-schema`.

## License

MIT
