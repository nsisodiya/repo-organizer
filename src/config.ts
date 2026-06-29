import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import type { Config } from "./types.js";

const CONFIG_DIR = join(homedir(), ".config", "repo-organizer");
const CONFIG_PATH = join(CONFIG_DIR, "config.yaml");

export const DEFAULT_CONFIG: Config = {
  target_dir: join(homedir(), "Github"),
  scan_roots: [
    join(homedir(), "Coding"),
    join(homedir(), "Projects"),
    join(homedir(), "webmaker-projects"),
    join(homedir(), "agentOS"),
  ],
  exclude_globs: [
    "**/.cursor/**",
    "**/.gemini/**",
    "**/.codex/**",
    "**/.nvm/**",
    "**/node_modules/**",
  ],
  stale_after_days: 10,
  work_remote_hosts: ["gitlab.com", "bitbucket.org"],
  cleanup_allowlist: ["node_modules"],
  default_visibility: "private",
};

function expandPath(p: string): string {
  if (p.startsWith("~/")) {
    return join(homedir(), p.slice(2));
  }
  return p;
}

function normalizeConfig(raw: Partial<Config>): Config {
  return {
    target_dir: expandPath(raw.target_dir ?? DEFAULT_CONFIG.target_dir),
    scan_roots: (raw.scan_roots ?? DEFAULT_CONFIG.scan_roots).map(expandPath),
    exclude_globs: raw.exclude_globs ?? DEFAULT_CONFIG.exclude_globs,
    stale_after_days: raw.stale_after_days ?? DEFAULT_CONFIG.stale_after_days,
    work_remote_hosts:
      raw.work_remote_hosts ?? DEFAULT_CONFIG.work_remote_hosts,
    cleanup_allowlist:
      raw.cleanup_allowlist ?? DEFAULT_CONFIG.cleanup_allowlist,
    default_visibility:
      raw.default_visibility ?? DEFAULT_CONFIG.default_visibility,
  };
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}

export function loadConfig(): Config {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  if (!existsSync(CONFIG_PATH)) {
    const quote = (s: string) => (s.includes("*") || s.includes("#") ? `"${s}"` : s);
    const yaml = [
      `target_dir: ~/Github`,
      `scan_roots:`,
      ...DEFAULT_CONFIG.scan_roots.map(
        (r) => `  - ~/${r.replace(homedir() + "/", "")}`,
      ),
      `exclude_globs:`,
      ...DEFAULT_CONFIG.exclude_globs.map((g) => `  - ${quote(g)}`),
      `stale_after_days: ${DEFAULT_CONFIG.stale_after_days}`,
      `work_remote_hosts:`,
      ...DEFAULT_CONFIG.work_remote_hosts.map((h) => `  - ${h}`),
      `cleanup_allowlist:`,
      ...DEFAULT_CONFIG.cleanup_allowlist.map((a) => `  - ${a}`),
      `default_visibility: ${DEFAULT_CONFIG.default_visibility}`,
    ].join("\n");
    writeFileSync(CONFIG_PATH, yaml + "\n", "utf-8");
    return { ...DEFAULT_CONFIG };
  }

  const content = readFileSync(CONFIG_PATH, "utf-8");
  const parsed = parse(content) as Partial<Config>;
  return normalizeConfig(parsed);
}
