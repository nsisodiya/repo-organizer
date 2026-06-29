import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isGhAvailable } from "../actions/github.js";
import { loadConfig } from "../config.js";
import { appendHistory } from "../store.js";
import type { Config } from "../types.js";
import { commandExists, runCommand } from "../utils/command.js";
import { openInEditor, openInGitHubDesktop } from "../utils/editor.js";

const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export interface CreateOptions {
  visibility?: "private" | "public";
  empty?: boolean;
  noOpen?: boolean;
  noDesktop?: boolean;
  parentDir?: string;
}

export interface CreateStep {
  label: string;
  ok: boolean;
  detail?: string;
}

export interface CreateResult {
  path: string;
  name: string;
  repoUrl?: string;
  steps: CreateStep[];
}

function logStep(step: CreateStep): void {
  const icon = step.ok ? "✓" : "✗";
  const detail = step.detail ? ` — ${step.detail}` : "";
  console.log(`${icon} ${step.label}${detail}`);
}

function validateName(name: string): void {
  if (!name || name === "." || name === "..") {
    throw new Error("Project name is required.");
  }
  if (!NAME_PATTERN.test(name)) {
    throw new Error(
      "Invalid project name. Use letters, numbers, hyphens, underscores, or dots.",
    );
  }
}

function scaffoldRepo(dir: string, name: string): void {
  writeFileSync(
    join(dir, "README.md"),
    `# ${name}\n\nCreated with [repo-organizer](https://github.com/nsisodiya/repo-organizer) (\`ro create\`).\n`,
    "utf-8",
  );
  writeFileSync(
    join(dir, ".gitignore"),
    [".DS_Store", "node_modules/", ".env", ".env.*", "dist/", ".netlify"].join(
      "\n",
    ) + "\n",
    "utf-8",
  );
}

function initGit(dir: string): CreateStep {
  const branch = runCommand("git", ["init", "-b", "main"], dir);
  if (!branch.ok) {
    return { label: "Initialize git repository", ok: false, detail: branch.error };
  }
  return { label: "Initialize git repository (main)", ok: true };
}

function initialCommit(dir: string): CreateStep {
  const add = runCommand("git", ["add", "."], dir);
  if (!add.ok) {
    return { label: "Stage scaffold files", ok: false, detail: add.error };
  }
  const commit = runCommand(
    "git",
    ["commit", "-m", "Initial commit"],
    dir,
  );
  if (!commit.ok) {
    return { label: "Create initial commit", ok: false, detail: commit.error };
  }
  return { label: "Create initial commit", ok: true };
}

function publishToGithub(
  dir: string,
  name: string,
  visibility: "private" | "public",
  push: boolean,
): { step: CreateStep; repoUrl?: string } {
  const args = [
    "repo",
    "create",
    name,
    `--${visibility}`,
    "--source=.",
    "--remote=origin",
  ];
  if (push) args.push("--push");

  const create = runCommand("gh", args, dir);
  if (!create.ok) {
    return {
      step: {
        label: `Publish to GitHub (${visibility})`,
        ok: false,
        detail: create.error,
      },
    };
  }

  const view = runCommand(
    "gh",
    ["repo", "view", "--json", "url", "-q", ".url"],
    dir,
  );
  const repoUrl = view.ok ? view.output : undefined;

  return {
    step: {
      label: `Publish to GitHub (${visibility})`,
      ok: true,
      detail: repoUrl,
    },
    repoUrl,
  };
}

export function createRepo(
  name: string,
  options: CreateOptions = {},
): CreateResult {
  validateName(name);

  if (!commandExists("git")) {
    throw new Error("git is not installed or not on PATH.");
  }
  if (!isGhAvailable()) {
    throw new Error("gh CLI is not installed. Install and run: gh auth login");
  }

  const config = loadConfig();
  const visibility = options.visibility ?? config.default_visibility;
  const parentDir = options.parentDir ?? config.target_dir;
  const dir = join(parentDir, name);
  const steps: CreateStep[] = [];

  if (existsSync(dir)) {
    throw new Error(`Directory already exists: ${dir}`);
  }

  mkdirSync(dir, { recursive: true });
  steps.push({ label: `Create folder ${dir}`, ok: true });

  const gitStep = initGit(dir);
  steps.push(gitStep);
  if (!gitStep.ok) {
    for (const step of steps) logStep(step);
    return { path: dir, name, steps };
  }

  const push = !options.empty;
  if (!options.empty) {
    scaffoldRepo(dir, name);
    steps.push({ label: "Add README.md and .gitignore", ok: true });
    const commitStep = initialCommit(dir);
    steps.push(commitStep);
    if (!commitStep.ok) {
      for (const step of steps) logStep(step);
      return { path: dir, name, steps };
    }
  }

  const published = publishToGithub(dir, name, visibility, push);
  steps.push(published.step);

  let repoUrl = published.repoUrl;
  if (!published.step.ok) {
    for (const step of steps) logStep(step);
    appendHistory({
      timestamp: new Date().toISOString(),
      action: "create",
      repo: name,
      details: { path: dir, visibility, steps },
      success: false,
      error: published.step.detail,
    });
    throw new Error(published.step.detail ?? "GitHub publish failed");
  }

  if (!options.noDesktop) {
    const desktop = openInGitHubDesktop(dir);
    steps.push({
      label: "Add to GitHub Desktop",
      ok: desktop.opened,
      detail: desktop.opened ? undefined : desktop.skipped,
    });
  }

  if (!options.noOpen) {
    const editor = openInEditor(dir);
    steps.push({
      label: "Open in editor",
      ok: editor.opened,
      detail: editor.opened ? editor.editor : editor.skipped,
    });
  }

  for (const step of steps) logStep(step);

  appendHistory({
    timestamp: new Date().toISOString(),
    action: "create",
    repo: name,
    details: { path: dir, visibility, repoUrl, steps },
    success: true,
  });

  console.log("");
  console.log(`Ready: ${dir}`);
  if (repoUrl) console.log(`Remote: ${repoUrl}`);
  console.log(`cd ${dir}`);

  return { path: dir, name, repoUrl, steps };
}

export function getCreateTargetDir(config: Config = loadConfig()): string {
  return config.target_dir;
}
