#!/usr/bin/env node
import { Command } from "commander";
import fs from "fs";
import path from "path";
import chalk from "chalk";
import { loadKnowledgeBase, matchError, resolveKbDir, getCacheKbDir, syncKnowledgeBase } from "./knowledgeBase";
import type { KnowledgeBaseEntry } from "./knowledgeBase";
import { getAIDiagnosis } from "./aiFallback";
import { DEFAULT_KB_REPO, DEFAULT_KB_REF } from "./config";
import { VALID_TOOLS, saveLastScan, clearLastScan, loadLastScan, slugify, buildSignature, renderDraftYaml } from "./contribute";

const program = new Command();

program
  .name("fixdb")
  .description(
    "Diagnose DevOps/infrastructure errors against a shared, open-source knowledge base"
  )
  .version("0.1.0");

program
  .command("scan")
  .description("Scan an error (from a log file or as a raw string) for a known fix")
  .argument("<input>", "path to a log file, or a raw error string")
  .option("-t, --tool <tool>", "restrict matching to a specific tool (terraform | kubernetes | github-actions)")
  .option("--kb <path>", "path to a local knowledge-base directory (defaults to the ~/.fixdb cache, seeded from the bundled snapshot on first use)")
  .action(async (input: string, options: { tool?: string; kb?: string }) => {
    const rawError = fs.existsSync(input) ? fs.readFileSync(input, "utf8") : input;

    const entries = loadKnowledgeBase(resolveKbDir(options.kb));
    const matches = matchError(rawError, entries, options.tool);

    if (matches.length > 0) {
      const best = matches[0];
      clearLastScan();
      console.log(chalk.green.bold(`\n✔ Match found: ${best.entry.title}`));
      console.log(chalk.dim(`  (${best.entry.confirmed_by ?? 0} confirmations)`));
      console.log(chalk.bold("\nCause:"));
      console.log(`  ${best.entry.cause}`);
      console.log(chalk.bold("\nFix:"));
      console.log(`  ${best.entry.fix}`);
      return;
    }

    console.log(chalk.yellow("\nNo known match in the local knowledge base."));

    if (!process.env.ANTHROPIC_API_KEY) {
      saveLastScan({ tool: options.tool ?? "unknown", rawError, scannedAt: new Date().toISOString() });
      console.log(
        chalk.dim(
          "Set ANTHROPIC_API_KEY to get an AI best-guess diagnosis, or run `fixdb contribute` once you've solved this yourself."
        )
      );
      return;
    }

    console.log(chalk.dim("Asking Claude for a best-guess diagnosis..."));
    const diagnosis = await getAIDiagnosis(rawError, options.tool ?? "unknown");
    saveLastScan({
      tool: options.tool ?? "unknown",
      rawError,
      aiDiagnosis: { cause: diagnosis.cause, fix: diagnosis.fix },
      scannedAt: new Date().toISOString(),
    });

    console.log(chalk.magenta.bold("\n~ AI best guess (unconfirmed) ~"));
    console.log(chalk.bold("\nCause:"));
    console.log(`  ${diagnosis.cause}`);
    console.log(chalk.bold("\nFix:"));
    console.log(`  ${diagnosis.fix}`);
    console.log(
      chalk.dim(
        "\nIf this fix worked, run `fixdb contribute --title \"...\"` to draft a knowledge base entry for the next person."
      )
    );
  });

program
  .command("update")
  .description("Sync the local knowledge base cache from a GitHub repo")
  .option("--repo <owner/repo>", "GitHub repo to sync from", DEFAULT_KB_REPO)
  .option("--ref <branch>", "branch or ref to sync from", DEFAULT_KB_REF)
  .action(async (options: { repo: string; ref: string }) => {
    const cacheDir = getCacheKbDir();
    try {
      const count = await syncKnowledgeBase(options.repo, options.ref, cacheDir);
      console.log(chalk.green(`✔ Synced ${count} knowledge base entries from ${options.repo}@${options.ref}`));
    } catch (err) {
      console.log(
        chalk.yellow(
          `Could not sync knowledge base from ${options.repo}@${options.ref} (${(err as Error).message}). Using last-cached copy.`
        )
      );
      // Make sure a fresh install still has *something* to match against.
      resolveKbDir();
    }
  });

program
  .command("contribute")
  .description("Draft a new knowledge base YAML entry from a confirmed fix")
  .argument("[input]", "path to a log file or raw error string (defaults to the last unmatched scan)")
  .option("-t, --tool <tool>", "tool: terraform | kubernetes | github-actions")
  .option("--title <title>", "short human-readable summary (required)")
  .option("--cause <text>", "plain-language root cause (defaults to the last AI diagnosis, if any)")
  .option("--fix <text>", "plain-language fix, exact commands where relevant (defaults to the last AI diagnosis, if any)")
  .option("--provider <provider>", "optional provider, e.g. azurerm, azapi")
  .option("--signature <regex>", "regex used for matching (auto-derived from the error text if omitted)")
  .option("--tags <tags>", "comma-separated tags")
  .option("--out <dir>", "output directory for the draft file", "./fixdb-contributions")
  .action(
    (
      input: string | undefined,
      options: {
        tool?: string;
        title?: string;
        cause?: string;
        fix?: string;
        provider?: string;
        signature?: string;
        tags?: string;
        out: string;
      }
    ) => {
      const lastScan = loadLastScan();

      const rawError = input
        ? fs.existsSync(input)
          ? fs.readFileSync(input, "utf8")
          : input
        : lastScan?.rawError;

      const tool = options.tool ?? lastScan?.tool;
      if (!tool || !(VALID_TOOLS as readonly string[]).includes(tool)) {
        console.error(
          chalk.red(
            `--tool is required and must be one of: ${VALID_TOOLS.join(", ")} (got ${tool ?? "none"}).`
          )
        );
        process.exitCode = 1;
        return;
      }

      if (!options.title) {
        console.error(chalk.red("--title is required, e.g. --title \"Pod stuck in ImagePullBackOff\"."));
        process.exitCode = 1;
        return;
      }

      const cause = options.cause ?? lastScan?.aiDiagnosis?.cause;
      const fix = options.fix ?? lastScan?.aiDiagnosis?.fix;
      if (!cause || !fix) {
        console.error(
          chalk.red(
            "No --cause/--fix given, and no AI diagnosis from a prior scan to default from. Pass both explicitly."
          )
        );
        process.exitCode = 1;
        return;
      }

      const signature = options.signature ?? (rawError ? buildSignature(rawError) : undefined);
      if (!signature) {
        console.error(
          chalk.red(
            "Could not derive --signature: no error text available. Pass one as an argument, run `fixdb scan` first, or pass --signature explicitly."
          )
        );
        process.exitCode = 1;
        return;
      }

      const id = `${tool}-${slugify(options.title)}`;
      const entry: KnowledgeBaseEntry = {
        id,
        tool: tool as KnowledgeBaseEntry["tool"],
        ...(options.provider ? { provider: options.provider } : {}),
        signature,
        title: options.title,
        cause,
        fix,
        tags: options.tags ? options.tags.split(",").map((t) => t.trim()) : [tool],
        confirmed_by: 1,
      };

      fs.mkdirSync(options.out, { recursive: true });
      const destPath = path.join(options.out, `${id}.yaml`);
      const fromAiFallback = !options.cause && !!lastScan?.aiDiagnosis;
      fs.writeFileSync(destPath, renderDraftYaml(entry, fromAiFallback), "utf8");

      console.log(chalk.green(`\n✔ Draft written to ${destPath}`));
      console.log(
        chalk.dim(
          `\nNext steps:\n  1. Review/edit the entry, especially the "signature" regex.\n  2. Fork the fixdb repo and copy this file into knowledge-base/${tool}/.\n  3. Open a pull request.`
        )
      );
    }
  );

program.parse();
