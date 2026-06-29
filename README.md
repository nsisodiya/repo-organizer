# Repo Organizer (`ro`)

A CLI and terminal UI for scanning scattered git repositories, classifying them by health and location, and safely consolidating them into a single target directory (for example `~/Github`).

## Features

- **Scan** multiple directories for git repos with configurable exclusions
- **Classify** each repo (dirty, needs move, no remote, work remote, stale, etc.)
- **Interactive TUI** dashboard with filters, search, and per-repo detail views
- **Safe actions** — dry-run preview and typed `yes` confirmation before anything runs
- **Move** repos into a flat `target_dir/project-name` layout
- **Create GitHub repos** and push local-only projects (`gh repo create`)
- **Migrate remotes** from GitLab, Bitbucket, or other hosts to GitHub
- **Cleanup** stale artifact directories (e.g. `node_modules`) on an allowlist
- **JSON output** for scripting (`ro scan`, `ro scan --pretty`)
- **Action history** logged locally for auditability

## Prerequisites

- **Node.js 20+** (see `engines` in `package.json`)
- **git** on your `PATH`
- **[GitHub CLI (`gh`)](https://cli.github.com/)** — required for create/migrate actions (scan and move work without it)

Authenticate `gh` before using remote actions:

```bash
gh auth login
```

## Installation

### From GitHub (recommended)

```bash
npm install -g github:nsisodiya/repo-organizer
```

### Clone and link (development)

```bash
git clone https://github.com/nsisodiya/repo-organizer.git
cd repo-organizer
npm install
npm run build
npm link
```

### Run without installing

```bash
npx github:nsisodiya/repo-organizer scan --pretty
```

After the first run, the `ro` command is available globally if installed with `-g` or `npm link`.

## Quick start

```bash
# Open the interactive TUI (default)
ro

# Scan and print JSON summary
ro scan

# Pretty-printed JSON
ro scan --pretty

# Force a fresh scan (ignore cache)
ro scan --refresh --pretty
```

On first launch, `ro` creates a default config at `~/.config/repo-organizer/config.yaml`. Edit `scan_roots` and `target_dir` to match your machine before running a full scan.

## Configuration

Config file: `~/.config/repo-organizer/config.yaml` (created automatically on first run).

### Example

```yaml
target_dir: ~/Github
scan_roots:
  - ~/Coding
  - ~/Projects
  - ~/webmaker-projects
  - ~/agentOS
exclude_globs:
  - "**/.cursor/**"
  - "**/.gemini/**"
  - "**/.codex/**"
  - "**/.nvm/**"
  - "**/node_modules/**"
stale_after_days: 10
work_remote_hosts:
  - gitlab.com
  - bitbucket.org
cleanup_allowlist:
  - node_modules
default_visibility: private
```

### Options

| Option | Type | Description |
|--------|------|-------------|
| `target_dir` | path | Destination for consolidated repos. Each repo is moved to `target_dir/<repo-name>`. Supports `~/` expansion. |
| `scan_roots` | list of paths | Directories to walk recursively looking for `.git` folders. |
| `exclude_globs` | list of globs | Paths to skip during scanning (tooling caches, `node_modules`, etc.). |
| `stale_after_days` | number | Repos with no commits newer than this many days **and** reclaimable artifacts are flagged for cleanup. |
| `work_remote_hosts` | list of hostnames | Origins on these hosts are classified as `work_remote` and never auto-migrated. |
| `cleanup_allowlist` | list of directory names | Only these top-level artifact folders (relative to repo root) may be deleted by cleanup. Default: `node_modules`. |
| `default_visibility` | `private` \| `public` | Visibility passed to `gh repo create` when creating or migrating repos. |

### State files

| File | Purpose |
|------|---------|
| `~/.local/share/repo-organizer/cache.json` | Last scan results (speeds up rescans) |
| `~/.local/share/repo-organizer/history.jsonl` | Append-only log of executed actions |

## TUI navigation

### Global

| Key | Action |
|-----|--------|
| `q` | Quit |
| `r` | Rescan all repos |

### Dashboard

| Key | Action |
|-----|--------|
| `Enter` / `l` | Open repo list |
| `h` | Open action history |

### Repo list

| Key | Action |
|-----|--------|
| `↑` / `↓` | Navigate repos |
| `Enter` | Open repo detail |
| `f` | Cycle category filter |
| `/` | Focus search (type name, path, or remote URL) |
| `Esc` | Back to dashboard |

### Repo detail

| Key | Action |
|-----|--------|
| `p` | Dry-run preview of suggested action |
| `a` | Approve action (preview → confirm) |
| `m` | Migrate work remote (only for `work_remote` category) |
| `Esc` | Back to list |

### Preview

| Key | Action |
|-----|--------|
| `y` | Continue to confirmation |
| `Esc` | Cancel and return to detail |

### Confirm

Type **`yes`** (exactly) and press Enter to execute. `Esc` cancels.

### History

| Key | Action |
|-----|--------|
| `Esc` / `Enter` | Back to dashboard |

## Actions reference

Every action follows the same safety flow: **preview → type `yes` → execute**. Nothing runs automatically.

### Move (`needs_move`)

Moves a repo from its current path to `target_dir/<name>` using `rename` (same filesystem).

**Safety notes:**

- Blocked if the repo has uncommitted changes (unless forced programmatically)
- Blocked if another repo shares the same name or the target path already exists
- Resolve `name_conflict` before moving

### Create GitHub repo (`no_remote`)

Runs `gh repo create <name> --<visibility> --source=. --remote=origin --push`.

**Safety notes:**

- Requires `gh` authentication
- Warns on dirty working trees; commit or stash first
- Uses `default_visibility` from config (`private` by default)

### Migrate to GitHub (`migrate_to_github`, `work_remote`)

Creates a GitHub repo, pushes, and optionally keeps the old remote renamed (e.g. `origin` → `gitlab`).

**Safety notes:**

- `work_remote` repos **cannot** be migrated with `a` — you must press `m` and confirm explicitly
- Work remotes are never auto-migrated during batch operations
- Review warnings on dirty repos before confirming

### Cleanup (`stale_cleanup`)

Deletes allowlisted artifact directories (default: `node_modules`) when a repo is stale and has reclaimable disk usage.

**Safety notes:**

- Only paths on `cleanup_allowlist` are touched — never arbitrary files
- Blocked on dirty repos unless forced
- Artifacts are removed with `rm -rf`; preview shows exact paths and sizes

## Classification categories

Repos receive one **primary** category (highest-priority match wins):

| Category | Meaning |
|----------|---------|
| `name_conflict` | Duplicate repo name elsewhere, or `target_dir/<name>` already exists |
| `dirty` | Uncommitted changes in the working tree |
| `needs_move` | Repo is not under `target_dir` |
| `no_remote` | No `origin` remote configured |
| `work_remote` | `origin` points to a host in `work_remote_hosts` (GitLab, Bitbucket, etc.) |
| `migrate_to_github` | `origin` exists but is not GitHub (personal/non-work host) |
| `stale_cleanup` | No commits within `stale_after_days` and allowlisted artifacts present |
| `healthy` | Under `target_dir`, GitHub remote, clean, and not stale |

Priority order (top wins): `name_conflict` → `dirty` → `needs_move` → `no_remote` → `work_remote` → `migrate_to_github` → `stale_cleanup` → `healthy`.

Tags on each repo may include multiple flags (e.g. a repo can be both `needs_move` and `dirty`, but `dirty` wins as the displayed category).

## Recommended migration workflow

Use this order when consolidating a messy machine into `~/Github`:

1. **Configure** — Edit `~/.config/repo-organizer/config.yaml`: set `target_dir`, `scan_roots`, and `work_remote_hosts`.
2. **Scan** — Run `ro` or `ro scan --pretty` and review category counts on the dashboard.
3. **Resolve name conflicts** — Rename or merge duplicate repos manually; `name_conflict` blocks moves.
4. **Commit or stash dirty repos** — Clean working trees before move or push actions.
5. **Move repos** — Work through `needs_move` entries: preview (`p`), then approve (`a`), confirm with `yes`.
6. **Create GitHub repos** — Handle `no_remote` repos with create + push.
7. **Migrate personal remotes** — Use `migrate_to_github` actions for non-GitHub origins you own.
8. **Review work remotes separately** — Only migrate `work_remote` with `m` after explicit review; never batch-migrate these.
9. **Cleanup stale artifacts** — Optionally reclaim disk from `stale_cleanup` repos.
10. **Rescan** — Press `r` to verify everything is `healthy`.

## Development

```bash
git clone https://github.com/nsisodiya/repo-organizer.git
cd repo-organizer
npm install

# Run TUI without building
npm run dev

# Run scan in dev mode
npm run dev -- scan --pretty

# Production build
npm run build

# Run built CLI
npm start
```

Stack: TypeScript, [Ink](https://github.com/vadimdemedes/ink) (React TUI), Commander, YAML config.

## License

MIT — see [LICENSE](LICENSE).
