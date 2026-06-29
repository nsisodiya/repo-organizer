import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ArtifactInfo, Config, DsStoreFileInfo, RemoteInfo } from "./types.js";

function runGit(repoPath: string, args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd: repoPath,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

function parseRemoteHost(url: string): string | null {
  const sshMatch = url.match(/@([^:/]+)[:/]/);
  if (sshMatch) return sshMatch[1].toLowerCase();

  try {
    const parsed = new URL(url.replace(/^git@([^:]+):/, "https://$1/"));
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function getRemotes(repoPath: string): RemoteInfo[] {
  const output = runGit(repoPath, ["remote", "-v"]);
  if (!output) return [];

  const seen = new Map<string, RemoteInfo>();
  for (const line of output.split("\n")) {
    const match = line.match(/^(\S+)\s+(\S+)\s+\(/);
    if (!match) continue;
    const [, name, url] = match;
    if (!seen.has(name)) {
      seen.set(name, {
        name,
        url,
        host: parseRemoteHost(url) ?? "",
      });
    }
  }
  return [...seen.values()];
}

export function getGitStatus(repoPath: string): { isDirty: boolean; dirtyCount: number } {
  const output = runGit(repoPath, ["status", "--porcelain"]);
  if (!output) {
    return { isDirty: false, dirtyCount: 0 };
  }
  const lines = output.split("\n").filter(Boolean);
  return { isDirty: lines.length > 0, dirtyCount: lines.length };
}

function parsePorcelainPath(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
  return trimmed;
}

export function getUntrackedDsStoreFiles(repoPath: string): DsStoreFileInfo[] {
  const output = runGit(repoPath, ["status", "--porcelain", "-u"]);
  if (!output) return [];

  const files: DsStoreFileInfo[] = [];
  for (const line of output.split("\n").filter(Boolean)) {
    if (!line.startsWith("?? ")) continue;

    const relativePath = parsePorcelainPath(line.slice(3));
    const baseName = relativePath.split("/").pop() ?? relativePath;
    if (baseName !== ".DS_Store") continue;

    const fullPath = join(repoPath, relativePath);
    let sizeBytes = 0;
    try {
      if (existsSync(fullPath)) {
        sizeBytes = statSync(fullPath).size;
      }
    } catch {
      continue;
    }

    files.push({ relativePath, path: fullPath, sizeBytes });
  }

  return files;
}

export function getLastCommit(repoPath: string): {
  date: string | null;
  daysAgo: number | null;
} {
  const output = runGit(repoPath, ["log", "-1", "--format=%cI"]);
  if (!output) {
    return { date: null, daysAgo: null };
  }
  const date = new Date(output);
  if (Number.isNaN(date.getTime())) {
    return { date: null, daysAgo: null };
  }
  const daysAgo = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
  return { date: output, daysAgo };
}

export function getCurrentBranch(repoPath: string): string | null {
  const branch = runGit(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return branch && branch !== "HEAD" ? branch : null;
}

function dirSizeBytes(dirPath: string): number {
  if (!existsSync(dirPath)) return 0;

  let total = 0;
  const stack = [dirPath];

  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const full = join(current, entry);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        stack.push(full);
      } else {
        total += stat.size;
      }
    }
  }

  return total;
}

export function getArtifacts(
  repoPath: string,
  allowlist: string[],
): ArtifactInfo[] {
  const artifacts: ArtifactInfo[] = [];

  for (const name of allowlist) {
    const artifactPath = join(repoPath, name);
    if (!existsSync(artifactPath)) continue;

    let stat;
    try {
      stat = statSync(artifactPath);
    } catch {
      continue;
    }

    if (!stat.isDirectory()) continue;

    artifacts.push({
      name,
      path: artifactPath,
      sizeBytes: dirSizeBytes(artifactPath),
    });
  }

  return artifacts;
}

export function isGitHubHost(host: string | null): boolean {
  if (!host) return false;
  return host === "github.com" || host.endsWith(".github.com");
}

export function isWorkRemote(host: string | null, config: Config): boolean {
  if (!host) return false;
  return config.work_remote_hosts.some(
    (h) => host === h || host.endsWith(`.${h}`),
  );
}

export function getStatusSummary(repoPath: string): string {
  return runGit(repoPath, ["status", "--short"]) || "(clean)";
}

export function getDiffStat(repoPath: string): string {
  const stat = runGit(repoPath, ["diff", "--stat"]);
  const staged = runGit(repoPath, ["diff", "--cached", "--stat"]);
  const parts = [];
  if (stat) parts.push(`Unstaged:\n${stat}`);
  if (staged) parts.push(`Staged:\n${staged}`);
  return parts.join("\n\n") || "(no diff)";
}
