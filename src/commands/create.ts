import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { isGhAvailable } from "../actions/github.js";
import { classifyAll } from "../classifier.js";
import { loadConfig } from "../config.js";
import { scanRepos } from "../scanner.js";
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

function normalizeGithubUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const normalized = url.trim().replace(/\.git$/i, "");
  const sshMatch = normalized.match(/^git@github\.com:(.+)$/i);
  if (sshMatch) {
    return `https://github.com/${sshMatch[1]?.toLowerCase()}`;
  }
  const httpsMatch = normalized.match(/^https:\/\/github\.com\/(.+)$/i);
  if (httpsMatch) {
    return `https://github.com/${httpsMatch[1]?.toLowerCase()}`;
  }
  return normalized.toLowerCase();
}

function getGithubLogin(cwd: string): string {
  const login = runCommand("gh", ["api", "user", "-q", ".login"], cwd);
  if (!login.ok || !login.output) {
    throw new Error(login.error ?? "Unable to determine authenticated GitHub user.");
  }
  return login.output.trim();
}

function lookupGithubRepo(
  name: string,
  cwd: string,
): { exists: boolean; repoUrl?: string; repoFullName?: string } {
  const owner = getGithubLogin(cwd);
  const repoFullName = `${owner}/${name}`;
  const view = runCommand(
    "gh",
    ["repo", "view", repoFullName, "--json", "url", "-q", ".url"],
    cwd,
  );
  if (view.ok) {
    return { exists: true, repoUrl: view.output, repoFullName };
  }

  const error = view.error ?? "";
  if (/not found|could not resolve to a repository|http 404/i.test(error)) {
    return { exists: false, repoFullName };
  }

  throw new Error(error || `Unable to check whether ${repoFullName} exists.`);
}

function findExistingLocalCheckout(
  name: string,
  parentDir: string,
  repoUrl?: string,
): string | null {
  const expectedDir = join(parentDir, name);
  if (existsSync(join(expectedDir, ".git"))) {
    return expectedDir;
  }

  if (!repoUrl) {
    return null;
  }

  const config = loadConfig();
  const normalizedRemote = normalizeGithubUrl(repoUrl);
  const repos = classifyAll(scanRepos(config), config);
  const matched = repos.find(
    (repo) => normalizeGithubUrl(repo.originUrl) === normalizedRemote,
  );
  return matched?.path ?? null;
}

async function confirmCheckout(dir: string): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(
      `GitHub repo already exists. Checkout existing repo into ${dir}? [y/N] `,
    );
    return /^(y|yes)$/i.test(answer.trim());
  } finally {
    rl.close();
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

export async function createRepo(
  name: string,
  options: CreateOptions = {},
): Promise<CreateResult> {
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

  const existingGithubRepo = lookupGithubRepo(name, process.cwd());
  if (existingGithubRepo.exists) {
    steps.push({
      label: "Check GitHub repo availability",
      ok: true,
      detail: `Already exists: ${existingGithubRepo.repoUrl}`,
    });

    const existingLocalPath = findExistingLocalCheckout(
      name,
      parentDir,
      existingGithubRepo.repoUrl,
    );

    if (existingLocalPath) {
      steps.push({
        label: "Use existing local checkout",
        ok: true,
        detail: existingLocalPath,
      });

      for (const step of steps) logStep(step);

      appendHistory({
        timestamp: new Date().toISOString(),
        action: "create",
        repo: name,
        details: {
          path: existingLocalPath,
          visibility,
          repoUrl: existingGithubRepo.repoUrl,
          repoAlreadyExisted: true,
          steps,
        },
        success: true,
      });

      console.log("");
      console.log(`Already checked out: ${existingLocalPath}`);
      if (existingGithubRepo.repoUrl) console.log(`Remote: ${existingGithubRepo.repoUrl}`);
      console.log(`cd ${existingLocalPath}`);

      return {
        path: existingLocalPath,
        name,
        repoUrl: existingGithubRepo.repoUrl,
        steps,
      };
    }

    const shouldClone = await confirmCheckout(dir);
    if (!shouldClone) {
      appendHistory({
        timestamp: new Date().toISOString(),
        action: "create",
        repo: name,
        details: {
          path: dir,
          visibility,
          repoUrl: existingGithubRepo.repoUrl,
          repoAlreadyExisted: true,
          steps,
        },
        success: false,
        error: "User declined to checkout existing repository.",
      });
      throw new Error(
        `GitHub repo already exists: ${existingGithubRepo.repoUrl ?? existingGithubRepo.repoFullName}`,
      );
    }

    if (existsSync(dir)) {
      throw new Error(`Directory already exists: ${dir}`);
    }

    const clone = runCommand(
      "gh",
      ["repo", "clone", existingGithubRepo.repoFullName ?? name, dir],
      process.cwd(),
    );
    const cloneStep: CreateStep = clone.ok
      ? { label: "Checkout existing GitHub repo", ok: true, detail: dir }
      : {
          label: "Checkout existing GitHub repo",
          ok: false,
          detail: clone.error,
        };
    steps.push(cloneStep);
    if (!cloneStep.ok) {
      for (const step of steps) logStep(step);
      throw new Error(cloneStep.detail ?? "Failed to checkout existing repository");
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
      details: {
        path: dir,
        visibility,
        repoUrl: existingGithubRepo.repoUrl,
        repoAlreadyExisted: true,
        steps,
      },
      success: true,
    });

    console.log("");
    console.log(`Ready: ${dir}`);
    if (existingGithubRepo.repoUrl) console.log(`Remote: ${existingGithubRepo.repoUrl}`);
    console.log(`cd ${dir}`);

    return {
      path: dir,
      name,
      repoUrl: existingGithubRepo.repoUrl,
      steps,
    };
  }

  steps.push({ label: "Check GitHub repo availability", ok: true, detail: "Available" });

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
