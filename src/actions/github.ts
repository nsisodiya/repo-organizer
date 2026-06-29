import { execFileSync } from "node:child_process";
import { appendHistory } from "../store.js";
import type { ActionPreview, Config, RepoInfo } from "../types.js";

function runGh(args: string[], cwd: string): { ok: boolean; output: string; error?: string } {
  try {
    const output = execFileSync("gh", args, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return { ok: true, output };
  } catch (err) {
    const error =
      err instanceof Error && "stderr" in err
        ? String((err as { stderr?: Buffer }).stderr ?? err.message)
        : String(err);
    return { ok: false, output: "", error: error.trim() };
  }
}

function runGit(args: string[], cwd: string): { ok: boolean; error?: string } {
  try {
    execFileSync("git", args, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { ok: true };
  } catch (err) {
    const error =
      err instanceof Error && "stderr" in err
        ? String((err as { stderr?: Buffer }).stderr ?? err.message)
        : String(err);
    return { ok: false, error: error.trim() };
  }
}

export function previewCreateGithub(
  repo: RepoInfo,
  config: Config,
  visibility?: "private" | "public",
): ActionPreview {
  const vis = visibility ?? config.default_visibility;
  const warnings: string[] = [];
  if (repo.isDirty) {
    warnings.push(`Repo has ${repo.dirtyCount} uncommitted change(s)`);
  }

  return {
    type: "github_create",
    repo,
    description: `Create GitHub repo '${repo.name}' (${vis}) and push`,
    dryRun: [
      `gh repo create ${repo.name} --${vis} --source=. --remote=origin --push`,
    ],
    warnings,
  };
}

export function executeCreateGithub(
  repo: RepoInfo,
  config: Config,
  options: { visibility?: "private" | "public"; force?: boolean } = {},
): { success: boolean; error?: string } {
  if (repo.isDirty && !options.force) {
    return {
      success: false,
      error: "Repo has uncommitted changes. Commit/stash or use force.",
    };
  }

  const vis = options.visibility ?? config.default_visibility;
  const result = runGh(
    ["repo", "create", repo.name, `--${vis}`, "--source=.", "--remote=origin", "--push"],
    repo.path,
  );

  appendHistory({
    timestamp: new Date().toISOString(),
    action: "github_create",
    repo: repo.name,
    details: { visibility: vis, path: repo.path },
    success: result.ok,
    error: result.error,
  });

  return result.ok
    ? { success: true }
    : { success: false, error: result.error ?? "gh repo create failed" };
}

export function previewMigrateGithub(
  repo: RepoInfo,
  config: Config,
  options: { keepOldRemote?: boolean; oldRemoteName?: string } = {},
): ActionPreview {
  const vis = config.default_visibility;
  const oldName = options.oldRemoteName ?? "gitlab";
  const warnings = [
    "Work/personal remote migration requires explicit approval",
  ];
  if (repo.isDirty) {
    warnings.push(`Repo has ${repo.dirtyCount} uncommitted change(s)`);
  }

  const steps = [
    `gh repo create ${repo.name} --${vis} --source=. --remote=origin --push`,
  ];
  if (options.keepOldRemote && repo.originUrl) {
    steps.push(`git remote rename origin ${oldName}`);
    steps.push(`git remote add origin git@github.com:<user>/${repo.name}.git`);
  }

  return {
    type: "github_migrate",
    repo,
    description: `Migrate '${repo.name}' to GitHub (${vis})`,
    dryRun: steps,
    warnings,
  };
}

export function executeMigrateGithub(
  repo: RepoInfo,
  config: Config,
  options: {
    visibility?: "private" | "public";
    keepOldRemote?: boolean;
    oldRemoteName?: string;
    force?: boolean;
    forceWorkRemote?: boolean;
  } = {},
): { success: boolean; error?: string } {
  if (repo.category === "work_remote" && !options.forceWorkRemote) {
    return {
      success: false,
      error:
        "Work remote — migration blocked. Use explicit work-remote approval (forceWorkRemote).",
    };
  }

  if (repo.isDirty && !options.force) {
    return {
      success: false,
      error: "Repo has uncommitted changes. Commit/stash or use force.",
    };
  }

  const vis = options.visibility ?? config.default_visibility;
  const oldUrl = repo.originUrl;
  const oldName = options.oldRemoteName ?? "gitlab";

  if (options.keepOldRemote && oldUrl) {
    const rename = runGit(["remote", "rename", "origin", oldName], repo.path);
    if (!rename.ok) {
      appendHistory({
        timestamp: new Date().toISOString(),
        action: "github_migrate",
        repo: repo.name,
        details: { path: repo.path, step: "rename" },
        success: false,
        error: rename.error,
      });
      return { success: false, error: rename.error ?? "git remote rename failed" };
    }
  }

  const create = runGh(
    [
      "repo",
      "create",
      repo.name,
      `--${vis}`,
      "--source=.",
      "--remote=origin",
      "--push",
    ],
    repo.path,
  );

  if (!create.ok) {
    appendHistory({
      timestamp: new Date().toISOString(),
      action: "github_migrate",
      repo: repo.name,
      details: { path: repo.path, step: "create" },
      success: false,
      error: create.error,
    });
    return { success: false, error: create.error ?? "gh repo create failed" };
  }

  appendHistory({
    timestamp: new Date().toISOString(),
    action: "github_migrate",
    repo: repo.name,
    details: {
      path: repo.path,
      keepOldRemote: options.keepOldRemote,
      oldRemote: oldUrl,
    },
    success: true,
  });

  return { success: true };
}

export function isGhAvailable(): boolean {
  try {
    execFileSync("gh", ["--version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
