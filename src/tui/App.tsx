import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import { executeCleanup, previewCleanup } from "../actions/cleanup.js";
import {
  executeCreateGithub,
  executeMigrateGithub,
  previewCreateGithub,
  previewMigrateGithub,
} from "../actions/github.js";
import { executeMove, previewMove } from "../actions/move.js";
import { getDiffStat, getStatusSummary } from "../analyzer.js";
import { loadConfig } from "../config.js";
import { runScan } from "../scan.js";
import { formatBytes, loadHistory } from "../store.js";
import type { ActionPreview, RepoCategory, RepoInfo, ScanSummary } from "../types.js";

type View = "dashboard" | "list" | "detail" | "preview" | "confirm" | "history" | "scanning";

const CATEGORIES: Array<{ label: string; value: RepoCategory | "all" }> = [
  { label: "All", value: "all" },
  { label: "Name conflict", value: "name_conflict" },
  { label: "Dirty", value: "dirty" },
  { label: "Needs move", value: "needs_move" },
  { label: "No remote", value: "no_remote" },
  { label: "Work remote", value: "work_remote" },
  { label: "Migrate to GitHub", value: "migrate_to_github" },
  { label: "Stale cleanup", value: "stale_cleanup" },
  { label: "Healthy", value: "healthy" },
];

const CATEGORY_COLORS: Record<RepoCategory, string> = {
  name_conflict: "red",
  dirty: "yellow",
  needs_move: "cyan",
  no_remote: "magenta",
  work_remote: "blue",
  migrate_to_github: "green",
  stale_cleanup: "gray",
  healthy: "greenBright",
};

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

export function App(): React.ReactElement {
  const { exit } = useApp();
  const [view, setView] = useState<View>("scanning");
  const [summary, setSummary] = useState<ScanSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<RepoCategory | "all">("all");
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [preview, setPreview] = useState<ActionPreview | null>(null);
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [migrateWorkRemote, setMigrateWorkRemote] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => Promise<void>) | null>(null);
  const config = useMemo(() => loadConfig(), []);

  const refresh = useCallback(async () => {
    setView("scanning");
    setError(null);
    try {
      const s = await runScan({ refresh: true });
      setSummary(s);
      setView("dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setView("dashboard");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filteredRepos = useMemo(() => {
    if (!summary) return [];
    let repos = summary.repos;
    if (filter !== "all") {
      repos = repos.filter((r) => r.category === filter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      repos = repos.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.path.toLowerCase().includes(q) ||
          (r.originUrl ?? "").toLowerCase().includes(q),
      );
    }
    return repos;
  }, [summary, filter, search]);

  const selectedRepo: RepoInfo | null = filteredRepos[selectedIndex] ?? null;

  useInput((input, key) => {
    if (view === "confirm") return;
    if (input === "q") {
      exit();
      return;
    }
    if (input === "r" && view !== "scanning") {
      void refresh();
      return;
    }

    if (view === "dashboard") {
      if (input === "l" || key.return) setView("list");
      if (input === "h") setView("history");
    }

    if (view === "list") {
      if (key.upArrow) setSelectedIndex((i) => Math.max(0, i - 1));
      if (key.downArrow)
        setSelectedIndex((i) => Math.min(filteredRepos.length - 1, i + 1));
      if (key.return && selectedRepo) setView("detail");
      if (input === "f") {
        const idx = CATEGORIES.findIndex((c) => c.value === filter);
        const next = CATEGORIES[(idx + 1) % CATEGORIES.length];
        setFilter(next!.value);
        setSelectedIndex(0);
      }
      if (key.escape) setView("dashboard");
    }

    if (view === "detail") {
      if (key.escape) setView("list");
      if (input === "p" && selectedRepo) showActionPreview(selectedRepo, false);
      if (input === "a" && selectedRepo) queueAction(selectedRepo, false);
      if (input === "m" && selectedRepo?.category === "work_remote") {
        showActionPreview(selectedRepo, true);
        queueAction(selectedRepo, true);
      }
    }

    if (view === "preview") {
      if (key.escape) {
        setView("detail");
        setPendingAction(null);
        setMigrateWorkRemote(false);
      }
      if (input === "y" && pendingAction) {
        setConfirmText("");
        setView("confirm");
      }
    }

    if (view === "history") {
      if (key.escape || key.return) setView("dashboard");
    }
  });

  function showActionPreview(repo: RepoInfo, workMigrate: boolean): void {
    let p: ActionPreview;
    switch (repo.category) {
      case "needs_move":
        p = previewMove(repo);
        break;
      case "no_remote":
        p = previewCreateGithub(repo, config);
        break;
      case "work_remote":
        p = previewMigrateGithub(repo, config, { keepOldRemote: true });
        p.warnings.unshift(
          "WORK REMOTE — never auto-migrated. Type yes on next screen to confirm.",
        );
        break;
      case "migrate_to_github":
        p = previewMigrateGithub(repo, config, { keepOldRemote: true });
        break;
      case "stale_cleanup":
        p = previewCleanup(repo);
        break;
      default:
        p = {
          type: "move",
          repo,
          description: "No automated action for this category",
          dryRun: [],
          warnings: ["Review manually"],
        };
    }
    if (workMigrate) setMigrateWorkRemote(true);
    setPreview(p);
    setView("preview");
  }

  function queueAction(repo: RepoInfo, workMigrate: boolean): void {
    if (repo.category === "work_remote" && !workMigrate) {
      setError("Work remotes require explicit approval — press m to migrate.");
      return;
    }

    const action = async () => {
      let res: { success: boolean; error?: string };
      switch (repo.category) {
        case "needs_move":
          res = executeMove(repo);
          break;
        case "no_remote":
          res = executeCreateGithub(repo, config);
          break;
        case "work_remote":
          res = executeMigrateGithub(repo, config, {
            keepOldRemote: true,
            forceWorkRemote: true,
          });
          break;
        case "migrate_to_github":
          res = executeMigrateGithub(repo, config, { keepOldRemote: true });
          break;
        case "stale_cleanup":
          res = executeCleanup(repo);
          break;
        default:
          res = { success: false, error: "No action available" };
      }
      if (!res.success) setError(res.error ?? "Action failed");
      else setResultMsg("Action completed successfully.");
      setMigrateWorkRemote(false);
    };
    setPendingAction(() => action);
    showActionPreview(repo, workMigrate);
  }

  if (view === "scanning") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="cyan" bold>
          repo-organizer (ro)
        </Text>
        <Text>Scanning repositories…</Text>
      </Box>
    );
  }

  if (!summary) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red">Failed to load: {error ?? "unknown error"}</Text>
        <Text dimColor>Press q to quit, r to rescan</Text>
      </Box>
    );
  }

  if (view === "history") {
    const history = loadHistory(20);
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">
          Action History
        </Text>
        {history.length === 0 ? (
          <Text dimColor>No actions yet</Text>
        ) : (
          history.map((h, i) => (
            <Text key={i}>
              <Text dimColor>{h.timestamp.slice(0, 19)}</Text>{" "}
              <Text color={h.success ? "green" : "red"}>{h.action}</Text>{" "}
              {h.repo}
              {h.error ? ` — ${h.error}` : ""}
            </Text>
          ))
        )}
        <Box marginTop={1}>
          <Text dimColor>Esc/Enter: back</Text>
        </Box>
      </Box>
    );
  }

  if (view === "dashboard") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="cyan" bold>
          repo-organizer — Dashboard
        </Text>
        <Text dimColor>
          Scanned {summary.totalRepos} repos at {summary.scannedAt.slice(0, 19)}
        </Text>
        <Box marginTop={1} flexDirection="column">
          {CATEGORIES.filter((c) => c.value !== "all").map((c) => (
            <Text key={c.value}>
              <Text color={CATEGORY_COLORS[c.value as RepoCategory]}>{c.label.padEnd(20)}</Text>
              <Text bold>{summary.byCategory[c.value as RepoCategory]}</Text>
            </Text>
          ))}
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text>
            Artifacts: {formatBytes(summary.totalArtifactBytes)} | Reclaimable:{" "}
            {formatBytes(summary.reclaimableBytes)}
          </Text>
          <Text dimColor>Target: {config.target_dir}</Text>
        </Box>
        {error && (
          <Box marginTop={1}>
            <Text color="red">{error}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text dimColor>Enter/l: repo list | h: history | r: rescan | q: quit</Text>
        </Box>
      </Box>
    );
  }

  if (view === "preview" && preview) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="yellow">
          Dry-run Preview — {preview.repo.name}
        </Text>
        <Text>{preview.description}</Text>
        <Box marginTop={1} flexDirection="column">
          {preview.dryRun.map((line, i) => (
            <Text key={i} color="gray">
              {line}
            </Text>
          ))}
        </Box>
        {preview.warnings.length > 0 && (
          <Box marginTop={1} flexDirection="column">
            <Text color="red" bold>
              Warnings:
            </Text>
            {preview.warnings.map((w, i) => (
              <Text key={i} color="red">
                • {w}
              </Text>
            ))}
          </Box>
        )}
        <Box marginTop={1}>
          <Text dimColor>y: continue to confirm | Esc: back</Text>
        </Box>
      </Box>
    );
  }

  if (view === "confirm" && pendingAction) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="yellow">
          Confirm action — type yes to execute
        </Text>
        {preview && <Text>{preview.description}</Text>}
        {migrateWorkRemote && (
          <Text color="red">Work-remote migration — explicit approval required</Text>
        )}
        <Box marginTop={1}>
          <Text>Confirm: </Text>
          <TextInput
            value={confirmText}
            onChange={setConfirmText}
            onSubmit={(val) => {
              if (val.toLowerCase() === "yes") {
                void pendingAction().then(() => {
                  setView("detail");
                  void refresh();
                });
              } else {
                setError("Action cancelled — confirmation must be exactly 'yes'.");
                setView("preview");
              }
            }}
          />
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Esc: cancel</Text>
        </Box>
      </Box>
    );
  }

  if (view === "detail" && selectedRepo) {
    const repo = selectedRepo;
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">
          {repo.name}
        </Text>
        <Text dimColor>{repo.path}</Text>
        <Box marginTop={1} flexDirection="column">
          <Text>
            Category:{" "}
            <Text color={CATEGORY_COLORS[repo.category]} bold>
              {repo.category}
            </Text>
          </Text>
          <Text>Action: {repo.suggestedAction}</Text>
          <Text>Branch: {repo.branch ?? "—"}</Text>
          <Text>Dirty: {repo.isDirty ? `yes (${repo.dirtyCount})` : "no"}</Text>
          <Text>Origin: {repo.originUrl ?? "—"}</Text>
          <Text>
            Last commit:{" "}
            {repo.lastCommitDaysAgo !== null
              ? `${repo.lastCommitDaysAgo}d ago`
              : "—"}
          </Text>
          <Text>Artifacts: {formatBytes(repo.artifactBytes)}</Text>
          {repo.nameConflictWith && (
            <Text color="red">Conflict: {repo.nameConflictWith}</Text>
          )}
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text bold>Status</Text>
          <Text wrap="truncate">{getStatusSummary(repo.path).split("\n").join(" | ")}</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text bold>Remotes</Text>
          {repo.remotes.length === 0 ? (
            <Text dimColor>(none)</Text>
          ) : (
            repo.remotes.map((r) => (
              <Text key={r.name}>
                {r.name}: {r.url}
              </Text>
            ))
          )}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>
            p: preview | a: approve action | m: migrate work-remote | Esc: back
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="cyan" bold>
        Repositories ({filteredRepos.length}/{summary.totalRepos})
      </Text>
      <Text dimColor>
        Filter: {filter} | f: cycle filter | ↑↓: navigate | Enter: detail | Esc: dashboard
      </Text>
      <Box marginTop={1}>
        <Text dimColor>Search: </Text>
        <TextInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            setSelectedIndex(0);
          }}
          placeholder="name or path…"
        />
      </Box>
      <Box marginTop={1} flexDirection="column">
        {filteredRepos.slice(0, 20).map((repo, i) => (
          <Text key={repo.path} inverse={i === selectedIndex}>
            <Text color={CATEGORY_COLORS[repo.category]}>
              {repo.category.slice(0, 12).padEnd(12)}
            </Text>{" "}
            {truncate(repo.name, 24).padEnd(24)}{" "}
            <Text dimColor>{truncate(repo.path, 40)}</Text>
          </Text>
        ))}
        {filteredRepos.length > 20 && (
          <Text dimColor>…and {filteredRepos.length - 20} more</Text>
        )}
      </Box>
      {resultMsg && <Text color="green">{resultMsg}</Text>}
      {error && <Text color="red">{error}</Text>}
    </Box>
  );
}
