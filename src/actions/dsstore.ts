import { rmSync } from "node:fs";
import { appendHistory } from "../store.js";
import type { RepoInfo } from "../types.js";

export function executeDsStoreCleanup(repo: RepoInfo): {
  success: boolean;
  error?: string;
  deletedCount?: number;
  freedBytes?: number;
} {
  if (repo.dsStoreFiles.length === 0) {
    return { success: false, error: "No untracked .DS_Store files" };
  }

  const deleted: string[] = [];
  let freedBytes = 0;

  try {
    for (const file of repo.dsStoreFiles) {
      rmSync(file.path, { force: true });
      deleted.push(file.relativePath);
      freedBytes += file.sizeBytes;
    }

    appendHistory({
      timestamp: new Date().toISOString(),
      action: "ds_store_cleanup",
      repo: repo.name,
      details: { deleted, freedBytes },
      success: true,
    });

    return {
      success: true,
      deletedCount: deleted.length,
      freedBytes,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    appendHistory({
      timestamp: new Date().toISOString(),
      action: "ds_store_cleanup",
      repo: repo.name,
      details: { deleted },
      success: false,
      error,
    });
    return { success: false, error };
  }
}
