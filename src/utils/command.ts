import { execFileSync, spawn } from "node:child_process";

export function commandExists(cmd: string): boolean {
  try {
    const checker = process.platform === "win32" ? "where" : "which";
    execFileSync(checker, [cmd], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function runCommand(
  cmd: string,
  args: string[],
  cwd: string,
): { ok: boolean; output: string; error?: string } {
  try {
    const output = execFileSync(cmd, args, {
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

export function runDetached(cmd: string, args: string[], cwd: string): boolean {
  try {
    const child = spawn(cmd, args, {
      cwd,
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}
