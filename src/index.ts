#!/usr/bin/env node
import { Command } from "commander";
import React from "react";
import { render } from "ink";
import { loadConfig } from "./config.js";
import { runScan } from "./scan.js";
import { formatBytes } from "./store.js";
import { App } from "./tui/App.js";

const program = new Command();

program
  .name("ro")
  .description("Repo Organizer — scan, classify, and consolidate git repos into ~/Github")
  .version("0.1.0");

program
  .command("scan", { isDefault: false })
  .description("Scan repos and print JSON summary")
  .option("--refresh", "Force rescan (ignore cache)")
  .option("--pretty", "Pretty-print JSON")
  .action(async (opts: { refresh?: boolean; pretty?: boolean }) => {
    const summary = await runScan({ refresh: opts.refresh ?? true });
    const output = {
      scannedAt: summary.scannedAt,
      totalRepos: summary.totalRepos,
      byCategory: summary.byCategory,
      totalArtifactBytes: summary.totalArtifactBytes,
      reclaimableBytes: summary.reclaimableBytes,
      totalArtifactHuman: formatBytes(summary.totalArtifactBytes),
      reclaimableHuman: formatBytes(summary.reclaimableBytes),
      repos: summary.repos.map((r) => ({
        name: r.name,
        path: r.path,
        category: r.category,
        tags: r.tags,
        isDirty: r.isDirty,
        originUrl: r.originUrl,
        lastCommitDaysAgo: r.lastCommitDaysAgo,
        artifactBytes: r.artifactBytes,
        suggestedAction: r.suggestedAction,
      })),
    };
    console.log(JSON.stringify(output, null, opts.pretty ? 2 : 0));
  });

program
  .command("tui")
  .description("Open interactive TUI dashboard")
  .action(() => {
    render(React.createElement(App));
  });

program.action(() => {
  render(React.createElement(App));
});

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

// Ensure config exists on first run
loadConfig();
