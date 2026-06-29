import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { HistoryEntry, RepoInfo, ScanSummary } from "./types.js";

const DATA_DIR = join(homedir(), ".local", "share", "repo-organizer");
const CACHE_PATH = join(DATA_DIR, "cache.json");
const HISTORY_PATH = join(DATA_DIR, "history.jsonl");

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function getCachePath(): string {
  return CACHE_PATH;
}

export function getHistoryPath(): string {
  return HISTORY_PATH;
}

export function loadCache(): ScanSummary | null {
  ensureDataDir();
  if (!existsSync(CACHE_PATH)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(CACHE_PATH, "utf-8")) as ScanSummary;
  } catch {
    return null;
  }
}

export function saveCache(summary: ScanSummary): void {
  ensureDataDir();
  writeFileSync(CACHE_PATH, JSON.stringify(summary, null, 2) + "\n", "utf-8");
}

export function appendHistory(entry: HistoryEntry): void {
  ensureDataDir();
  appendFileSync(HISTORY_PATH, JSON.stringify(entry) + "\n", "utf-8");
}

export function loadHistory(limit = 50): HistoryEntry[] {
  ensureDataDir();
  if (!existsSync(HISTORY_PATH)) {
    return [];
  }
  const lines = readFileSync(HISTORY_PATH, "utf-8").trim().split("\n").filter(Boolean);
  return lines
    .slice(-limit)
    .map((line) => JSON.parse(line) as HistoryEntry)
    .reverse();
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

export function repoNameFromPath(repoPath: string): string {
  return repoPath.split("/").filter(Boolean).pop() ?? repoPath;
}

export function buildSummary(repos: RepoInfo[]): ScanSummary {
  const byCategory = {
    name_conflict: 0,
    dirty: 0,
    needs_move: 0,
    no_remote: 0,
    work_remote: 0,
    migrate_to_github: 0,
    stale_cleanup: 0,
    healthy: 0,
  } satisfies Record<RepoInfo["category"], number>;

  let totalArtifactBytes = 0;
  let reclaimableBytes = 0;

  for (const repo of repos) {
    byCategory[repo.category]++;
    totalArtifactBytes += repo.artifactBytes;
    if (repo.category === "stale_cleanup") {
      reclaimableBytes += repo.artifactBytes;
    }
  }

  return {
    scannedAt: new Date().toISOString(),
    totalRepos: repos.length,
    byCategory,
    totalArtifactBytes,
    reclaimableBytes,
    repos,
  };
}
