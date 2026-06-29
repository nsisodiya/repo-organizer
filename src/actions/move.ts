import { renameSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { appendHistory } from "../store.js";
import type { ActionPreview, RepoInfo } from "../types.js";

export function previewMove(repo: RepoInfo): ActionPreview {
  const warnings: string[] = [];
  if (repo.isDirty) {
    warnings.push(`Repo has ${repo.dirtyCount} uncommitted change(s) — move may be risky`);
  }
  if (repo.nameConflictWith) {
    warnings.push(`Name conflict with: ${repo.nameConflictWith}`);
  }
  if (existsSync(repo.targetPath) && repo.targetPath !== repo.path) {
    warnings.push(`Target already exists: ${repo.targetPath}`);
  }

  return {
    type: "move",
    repo,
    description: `Move ${repo.path} → ${repo.targetPath}`,
    dryRun: [
      `mkdir -p ${dirname(repo.targetPath)}`,
      `mv "${repo.path}" "${repo.targetPath}"`,
    ],
    warnings,
  };
}

export function executeMove(repo: RepoInfo, options: { force?: boolean } = {}): {
  success: boolean;
  error?: string;
  newPath?: string;
} {
  if (repo.path === repo.targetPath) {
    return { success: true, newPath: repo.path };
  }

  if (repo.isDirty && !options.force) {
    return {
      success: false,
      error: "Repo has uncommitted changes. Use force to move anyway.",
    };
  }

  if (repo.nameConflictWith && !options.force) {
    return {
      success: false,
      error: `Name conflict with ${repo.nameConflictWith}. Resolve before moving.`,
    };
  }

  if (existsSync(repo.targetPath)) {
    return {
      success: false,
      error: `Target already exists: ${repo.targetPath}`,
    };
  }

  try {
    renameSync(repo.path, repo.targetPath);
    appendHistory({
      timestamp: new Date().toISOString(),
      action: "move",
      repo: repo.name,
      details: { from: repo.path, to: repo.targetPath },
      success: true,
    });
    return { success: true, newPath: repo.targetPath };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    appendHistory({
      timestamp: new Date().toISOString(),
      action: "move",
      repo: repo.name,
      details: { from: repo.path, to: repo.targetPath },
      success: false,
      error,
    });
    return { success: false, error };
  }
}
