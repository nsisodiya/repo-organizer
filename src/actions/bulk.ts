import { existsSync } from "node:fs";
import { formatBytes } from "../store.js";
import type { BulkActionPreview, BulkExecuteResult, Config, RepoInfo } from "../types.js";
import { executeCleanup } from "./cleanup.js";
import { executeMove } from "./move.js";

export function getBulkMoveSkippedReason(repo: RepoInfo): string | null {
  if (repo.inTargetDir) return "Already in target directory";
  if (repo.isDirty) return `Uncommitted changes (${repo.dirtyCount})`;
  if (repo.nameConflictWith) return `Name conflict: ${repo.nameConflictWith}`;
  if (existsSync(repo.targetPath) && repo.targetPath !== repo.path) {
    return `Target exists: ${repo.targetPath}`;
  }
  return null;
}

export function isBulkMoveEligible(repo: RepoInfo): boolean {
  return !repo.inTargetDir && getBulkMoveSkippedReason(repo) === null;
}

export function getBulkCleanupSkippedReason(repo: RepoInfo): string | null {
  if (repo.artifactBytes === 0) return "No allowlisted artifacts";
  if (repo.isDirty) return `Uncommitted changes (${repo.dirtyCount})`;
  return null;
}

export function isBulkCleanupEligible(repo: RepoInfo): boolean {
  return getBulkCleanupSkippedReason(repo) === null;
}

export function previewBulkMove(repos: RepoInfo[], targetDir: string): BulkActionPreview {
  const eligible: RepoInfo[] = [];
  const skipped: Array<{ repo: RepoInfo; reason: string }> = [];

  for (const repo of repos) {
    if (repo.inTargetDir) continue;
    const reason = getBulkMoveSkippedReason(repo);
    if (reason) skipped.push({ repo, reason });
    else eligible.push(repo);
  }

  const warnings: string[] = [];
  if (skipped.some((s) => s.reason.startsWith("Name conflict"))) {
    warnings.push("Repos with name conflicts are skipped — resolve manually first.");
  }
  if (skipped.some((s) => s.reason.startsWith("Uncommitted"))) {
    warnings.push("Dirty repos are skipped — commit or stash before bulk move.");
  }
  if (skipped.some((s) => s.reason.startsWith("Target exists"))) {
    warnings.push("Repos whose destination folder already exists are skipped.");
  }

  return {
    type: "bulk_move",
    title: `Bulk move → ${targetDir}`,
    explanation: [
      "Move scattered repositories into your target directory as flat folders:",
      "  <target_dir>/<repo-name>",
      "",
      "Included: repos outside target_dir with no conflicts, no dirty working tree,",
      "and no existing folder at the destination.",
      "Excluded: name conflicts, uncommitted changes, and existing destinations.",
    ],
    eligible,
    skipped,
    dryRun: eligible.map((r) => `mv "${r.path}" → "${r.targetPath}"`),
    warnings,
  };
}

export function previewBulkCleanup(
  repos: RepoInfo[],
  config: Config,
): BulkActionPreview {
  const eligible: RepoInfo[] = [];
  const skipped: Array<{ repo: RepoInfo; reason: string }> = [];
  let totalBytes = 0;

  for (const repo of repos) {
    const reason = getBulkCleanupSkippedReason(repo);
    if (reason) {
      if (repo.artifactBytes > 0 || !repo.inTargetDir || repo.category === "stale_cleanup") {
        skipped.push({ repo, reason });
      }
      continue;
    }
    eligible.push(repo);
    totalBytes += repo.artifactBytes;
  }

  const allowlist = config.cleanup_allowlist.join(", ");
  const warnings: string[] = [
    "This permanently deletes folders — they can be regenerated (e.g. npm install).",
  ];
  if (skipped.some((s) => s.reason.startsWith("Uncommitted"))) {
    warnings.push("Dirty repos are skipped — commit or stash before bulk cleanup.");
  }

  return {
    type: "bulk_cleanup",
    title: "Bulk cleanup artifacts",
    explanation: [
      "Cleanup removes regenerable artifact folders from repositories.",
      "Your source code, git history, and other files are NOT touched.",
      "",
      `Only these folder names are deleted: ${allowlist}`,
      "(e.g. node_modules — reinstall dependencies when you work on the repo again)",
      "",
      `Eligible: ${eligible.length} repo(s), ${formatBytes(totalBytes)} reclaimable`,
    ],
    eligible,
    skipped,
    dryRun: eligible.flatMap((r) =>
      r.artifacts.map((a) => `rm -rf "${a.path}"  # ${r.name} ${formatBytes(a.sizeBytes)}`),
    ),
    warnings,
    totalBytes,
  };
}

export function executeBulkMove(repos: RepoInfo[]): BulkExecuteResult {
  const succeeded: string[] = [];
  const failed: Array<{ name: string; error: string }> = [];

  for (const repo of repos) {
    const res = executeMove(repo);
    if (res.success) succeeded.push(repo.name);
    else failed.push({ name: repo.name, error: res.error ?? "move failed" });
  }

  return { succeeded, failed };
}

export function executeBulkCleanup(repos: RepoInfo[]): BulkExecuteResult {
  const succeeded: string[] = [];
  const failed: Array<{ name: string; error: string }> = [];
  let freedBytes = 0;

  for (const repo of repos) {
    const res = executeCleanup(repo);
    if (res.success) {
      succeeded.push(repo.name);
      freedBytes += res.freedBytes ?? 0;
    } else {
      failed.push({ name: repo.name, error: res.error ?? "cleanup failed" });
    }
  }

  return { succeeded, failed, freedBytes };
}
