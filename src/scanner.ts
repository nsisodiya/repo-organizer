import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { minimatch } from "minimatch";
import type { Config } from "./types.js";

const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".cursor",
  ".gemini",
  ".codex",
  ".nvm",
]);

function isExcluded(absPath: string, scanRoot: string, excludeGlobs: string[]): boolean {
  const rel = relative(scanRoot, absPath).replace(/\\/g, "/");
  const patterns = [
    ...excludeGlobs,
    "**/.git/**",
  ];
  return patterns.some((pattern) => minimatch(rel, pattern, { dot: true }));
}

function isGitRepo(dir: string): boolean {
  const gitPath = join(dir, ".git");
  return existsSync(gitPath);
}

function walkForRepos(
  dir: string,
  scanRoot: string,
  config: Config,
  found: Set<string>,
): void {
  if (!existsSync(dir)) {
    return;
  }

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  if (isGitRepo(dir)) {
    found.add(dir);
    return;
  }

  if (isExcluded(dir, scanRoot, config.exclude_globs)) {
    return;
  }

  for (const entry of entries) {
    if (SKIP_DIR_NAMES.has(entry)) {
      continue;
    }

    const fullPath = join(dir, entry);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (!stat.isDirectory()) {
      continue;
    }

    if (isExcluded(fullPath, scanRoot, config.exclude_globs)) {
      continue;
    }

    if (isGitRepo(fullPath)) {
      found.add(fullPath);
      continue;
    }

    walkForRepos(fullPath, scanRoot, config, found);
  }
}

export function scanRepos(config: Config): string[] {
  const found = new Set<string>();

  for (const root of config.scan_roots) {
    if (!existsSync(root)) {
      continue;
    }

    if (isGitRepo(root)) {
      found.add(root);
      continue;
    }

    walkForRepos(root, root, config, found);
  }

  const target = config.target_dir;
  if (existsSync(target) && !config.scan_roots.includes(target)) {
    if (isGitRepo(target)) {
      found.add(target);
    } else {
      walkForRepos(target, target, config, found);
    }
  }

  return [...found].sort((a, b) => a.localeCompare(b));
}
