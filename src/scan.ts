import { loadConfig } from "./config.js";
import { classifyAll } from "./classifier.js";
import { scanRepos } from "./scanner.js";
import { buildSummary, loadCache, saveCache } from "./store.js";
import type { ScanSummary } from "./types.js";

export async function runScan(options: { useCache?: boolean; refresh?: boolean } = {}): Promise<ScanSummary> {
  if (options.useCache && !options.refresh) {
    const cached = loadCache();
    if (cached) return cached;
  }

  const config = loadConfig();
  const paths = scanRepos(config);
  const repos = classifyAll(paths, config);
  const summary = buildSummary(repos);
  saveCache(summary);
  return summary;
}
