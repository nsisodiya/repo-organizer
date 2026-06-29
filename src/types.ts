export type RepoCategory =
  | "name_conflict"
  | "dirty"
  | "needs_move"
  | "no_remote"
  | "work_remote"
  | "migrate_to_github"
  | "stale_cleanup"
  | "healthy";

export interface Config {
  target_dir: string;
  scan_roots: string[];
  exclude_globs: string[];
  stale_after_days: number;
  work_remote_hosts: string[];
  cleanup_allowlist: string[];
  default_visibility: "private" | "public";
}

export interface RemoteInfo {
  name: string;
  url: string;
  host: string;
}

export interface ArtifactInfo {
  name: string;
  path: string;
  sizeBytes: number;
}

export interface DsStoreFileInfo {
  relativePath: string;
  path: string;
  sizeBytes: number;
}

export interface RepoInfo {
  path: string;
  name: string;
  inTargetDir: boolean;
  targetPath: string;
  remotes: RemoteInfo[];
  originUrl: string | null;
  originHost: string | null;
  isDirty: boolean;
  dirtyCount: number;
  lastCommitDate: string | null;
  lastCommitDaysAgo: number | null;
  branch: string | null;
  artifacts: ArtifactInfo[];
  artifactBytes: number;
  dsStoreFiles: DsStoreFileInfo[];
  dsStoreBytes: number;
  category: RepoCategory;
  tags: string[];
  suggestedAction: string;
  nameConflictWith: string | null;
}

export interface ScanSummary {
  scannedAt: string;
  totalRepos: number;
  byCategory: Record<RepoCategory, number>;
  totalArtifactBytes: number;
  reclaimableBytes: number;
  repos: RepoInfo[];
}

export interface HistoryEntry {
  timestamp: string;
  action: string;
  repo: string;
  details: Record<string, unknown>;
  success: boolean;
  error?: string;
}

export interface ActionPreview {
  type: "move" | "cleanup" | "github_create" | "github_migrate";
  repo: RepoInfo;
  description: string;
  dryRun: string[];
  warnings: string[];
}

export type BulkActionType = "bulk_move" | "bulk_cleanup" | "bulk_ds_store";

export interface BulkActionPreview {
  type: BulkActionType;
  title: string;
  explanation: string[];
  eligible: RepoInfo[];
  skipped: Array<{ repo: RepoInfo; reason: string }>;
  dryRun: string[];
  warnings: string[];
  totalBytes?: number;
}

export interface BulkExecuteResult {
  succeeded: string[];
  failed: Array<{ name: string; error: string }>;
  freedBytes?: number;
}
