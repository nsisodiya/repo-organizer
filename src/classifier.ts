import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  getArtifacts,
  getCurrentBranch,
  getGitStatus,
  getLastCommit,
  getRemotes,
  getUntrackedDsStoreFiles,
  isGitHubHost,
  isWorkRemote,
} from "./analyzer.js";
import { repoNameFromPath } from "./store.js";
import type { Config, RepoCategory, RepoInfo } from "./types.js";

const CATEGORY_PRIORITY: RepoCategory[] = [
  "name_conflict",
  "dirty",
  "needs_move",
  "no_remote",
  "work_remote",
  "migrate_to_github",
  "stale_cleanup",
  "healthy",
];

function isUnderTarget(path: string, targetDir: string): boolean {
  const normalizedPath = path.replace(/\/+$/, "");
  const normalizedTarget = targetDir.replace(/\/+$/, "");
  return (
    normalizedPath === normalizedTarget ||
    normalizedPath.startsWith(normalizedTarget + "/")
  );
}

function buildTags(flags: Record<string, boolean>): string[] {
  return Object.entries(flags)
    .filter(([, v]) => v)
    .map(([k]) => k);
}

function suggestedActionFor(category: RepoCategory, repo: Partial<RepoInfo>): string {
  switch (category) {
    case "name_conflict":
      return `Resolve name conflict with ${repo.nameConflictWith ?? "another repo"}`;
    case "dirty":
      return "Review uncommitted changes before move/push";
    case "needs_move":
      return `Move to ${repo.targetPath}`;
    case "no_remote":
      return "Create GitHub repo and push (gh repo create)";
    case "work_remote":
      return "Work remote — review manually; migrate only on explicit approval";
    case "migrate_to_github":
      return "Migrate to GitHub (create repo + push + retarget origin)";
    case "stale_cleanup":
      return "Delete stale artifacts (node_modules) after confirmation";
    case "healthy":
      return "No action needed";
  }
}

export function analyzeRepo(repoPath: string, config: Config): Omit<RepoInfo, "category" | "tags" | "suggestedAction" | "nameConflictWith"> {
  const name = repoNameFromPath(repoPath);
  const inTargetDir = isUnderTarget(repoPath, config.target_dir);
  const targetPath = join(config.target_dir, name);
  const remotes = getRemotes(repoPath);
  const origin = remotes.find((r) => r.name === "origin") ?? null;
  const { isDirty, dirtyCount } = getGitStatus(repoPath);
  const { date: lastCommitDate, daysAgo: lastCommitDaysAgo } = getLastCommit(repoPath);
  const branch = getCurrentBranch(repoPath);
  const artifacts = getArtifacts(repoPath, config.cleanup_allowlist);
  const artifactBytes = artifacts.reduce((sum, a) => sum + a.sizeBytes, 0);
  const dsStoreFiles = getUntrackedDsStoreFiles(repoPath);
  const dsStoreBytes = dsStoreFiles.reduce((sum, f) => sum + f.sizeBytes, 0);

  return {
    path: repoPath,
    name,
    inTargetDir,
    targetPath,
    remotes,
    originUrl: origin?.url ?? null,
    originHost: origin?.host ?? null,
    isDirty,
    dirtyCount,
    lastCommitDate,
    lastCommitDaysAgo,
    branch,
    artifacts,
    artifactBytes,
    dsStoreFiles,
    dsStoreBytes,
  };
}

export function classifyRepo(
  base: Omit<RepoInfo, "category" | "tags" | "suggestedAction" | "nameConflictWith">,
  config: Config,
  allNames: Map<string, string[]>,
): RepoInfo {
  const candidates = new Set<RepoCategory>();
  const tags: Record<string, boolean> = {};

  const pathsWithSameName = allNames.get(base.name) ?? [];
  const conflictPaths = pathsWithSameName.filter((p) => p !== base.path);
  const targetExists =
    !base.inTargetDir && existsSync(base.targetPath) && base.targetPath !== base.path;

  if (conflictPaths.length > 0 || targetExists) {
    candidates.add("name_conflict");
    tags.name_conflict = true;
  }

  if (base.isDirty) {
    candidates.add("dirty");
    tags.dirty = true;
  }

  if (!base.inTargetDir) {
    candidates.add("needs_move");
    tags.needs_move = true;
  }

  if (!base.originUrl) {
    candidates.add("no_remote");
    tags.no_remote = true;
  } else if (isWorkRemote(base.originHost, config)) {
    candidates.add("work_remote");
    tags.work_remote = true;
  } else if (!isGitHubHost(base.originHost)) {
    candidates.add("migrate_to_github");
    tags.migrate_to_github = true;
  }

  const isStale =
    base.lastCommitDaysAgo !== null &&
    base.lastCommitDaysAgo >= config.stale_after_days &&
    base.artifactBytes > 0;

  if (isStale) {
    candidates.add("stale_cleanup");
    tags.stale = true;
  }

  if (base.dsStoreFiles.length > 0) {
    tags.ds_store = true;
  }

  if (
    base.inTargetDir &&
    isGitHubHost(base.originHost) &&
    !base.isDirty &&
    !isStale
  ) {
    candidates.add("healthy");
    tags.healthy = true;
  }

  let category: RepoCategory = "healthy";
  for (const cat of CATEGORY_PRIORITY) {
    if (candidates.has(cat)) {
      category = cat;
      break;
    }
  }

  const nameConflictWith =
    conflictPaths[0] ??
    (targetExists && base.targetPath !== base.path ? base.targetPath : null);

  const repo: RepoInfo = {
    ...base,
    category,
    tags: buildTags(tags),
    nameConflictWith,
    suggestedAction: "",
  };
  repo.suggestedAction = suggestedActionFor(category, repo);
  return repo;
}

export function classifyAll(repoPaths: string[], config: Config): RepoInfo[] {
  const bases = repoPaths.map((p) => analyzeRepo(p, config));

  const nameMap = new Map<string, string[]>();
  for (const base of bases) {
    const list = nameMap.get(base.name) ?? [];
    list.push(base.path);
    nameMap.set(base.name, list);
  }

  return bases.map((base) => classifyRepo(base, config, nameMap));
}
