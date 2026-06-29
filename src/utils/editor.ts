import { existsSync } from "node:fs";
import { join } from "node:path";
import { commandExists, runCommand, runDetached } from "./command.js";

export interface EditorOpenResult {
  opened: boolean;
  editor?: string;
  skipped?: string;
}

const CLI_EDITORS = ["cursor", "code", "antigravity", "agy", "windsurf", "zed"];

const MACOS_APPS = [
  "Cursor",
  "Antigravity",
  "Visual Studio Code",
  "Windsurf",
  "Zed",
];

function openWithCli(cmd: string, dir: string): boolean {
  if (!commandExists(cmd)) return false;
  return runDetached(cmd, [dir], dir);
}

function openMacApp(appName: string, dir: string): boolean {
  const appPath = join("/Applications", `${appName}.app`);
  if (!existsSync(appPath)) return false;
  const res = runCommand("open", ["-a", appName, dir], dir);
  return res.ok;
}

export function openInEditor(dir: string): EditorOpenResult {
  const fromEnv = process.env.RO_EDITOR?.trim();
  if (fromEnv) {
    if (openWithCli(fromEnv, dir) || openMacApp(fromEnv, dir)) {
      return { opened: true, editor: fromEnv };
    }
    return { opened: false, skipped: `RO_EDITOR=${fromEnv} not found` };
  }

  for (const cmd of CLI_EDITORS) {
    if (openWithCli(cmd, dir)) {
      return { opened: true, editor: cmd };
    }
  }

  if (process.platform === "darwin") {
    for (const app of MACOS_APPS) {
      if (openMacApp(app, dir)) {
        return { opened: true, editor: app };
      }
    }
  }

  if (process.platform === "darwin") {
    const res = runCommand("open", [dir], dir);
    if (res.ok) return { opened: true, editor: "Finder" };
  }

  return { opened: false, skipped: "no editor found (set RO_EDITOR)" };
}

export function openInGitHubDesktop(dir: string): EditorOpenResult {
  if (!commandExists("github")) {
    return { opened: false, skipped: "github CLI not installed" };
  }
  if (runDetached("github", ["."], dir)) {
    return { opened: true, editor: "GitHub Desktop" };
  }
  return { opened: false, skipped: "github . failed" };
}
