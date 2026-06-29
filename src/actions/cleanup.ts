import { rmSync } from "node:fs";
import { appendHistory, formatBytes } from "../store.js";
import type { ActionPreview, RepoInfo } from "../types.js";

export function previewCleanup(repo: RepoInfo): ActionPreview {
  const warnings: string[] = [];
  if (repo.artifactBytes === 0) {
    warnings.push("No artifacts found on cleanup allowlist");
  }

  const lines = repo.artifacts.map(
    (a) => `rm -rf "${a.path}"  # ${formatBytes(a.sizeBytes)}`,
  );

  return {
    type: "cleanup",
    repo,
    description: `Delete ${repo.artifacts.length} artifact(s) — ${formatBytes(repo.artifactBytes)} total`,
    dryRun: lines.length > 0 ? lines : ["(nothing to delete)"],
    warnings,
  };
}

export function executeCleanup(
  repo: RepoInfo,
  options: { force?: boolean } = {},
): { success: boolean; error?: string; freedBytes?: number } {
  if (repo.artifactBytes === 0) {
    return { success: false, error: "No artifacts to clean up" };
  }

  if (repo.isDirty && !options.force) {
    return {
      success: false,
      error: "Repo has uncommitted changes. Use force to cleanup anyway.",
    };
  }

  let freedBytes = 0;
  const deleted: string[] = [];

  try {
    for (const artifact of repo.artifacts) {
      if (artifact.sizeBytes === 0) continue;
      rmSync(artifact.path, { recursive: true, force: true });
      freedBytes += artifact.sizeBytes;
      deleted.push(artifact.path);
    }

    appendHistory({
      timestamp: new Date().toISOString(),
      action: "cleanup",
      repo: repo.name,
      details: { deleted, freedBytes },
      success: true,
    });

    return { success: true, freedBytes };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    appendHistory({
      timestamp: new Date().toISOString(),
      action: "cleanup",
      repo: repo.name,
      details: { deleted },
      success: false,
      error,
    });
    return { success: false, error };
  }
}
