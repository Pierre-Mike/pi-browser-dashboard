# global-settings — expertise

Single global settings file the dashboard owns and the UI manages:
`<claudeConfigDir>/pid-dashboard/settings.json` (GET/POST `/settings`). Mirrors
the `pid-settings` pattern (pure `*.core` parse/merge/serialize → `*.repo`
atomic file I/O → `*.routes` HTTP boundary), but at global scope rather than
per-project. Parse/merge fill missing or wrong-typed fields from
`DEFAULT_GLOBAL_SETTINGS` field-by-field, so a hand-edited or partial file never
throws and a bad PATCH can't corrupt stored state.

Four sections, each a single source of truth for values formerly hard-coded
across the daemon: `git`, `library`, `orchestration`, `network`.

## Consumer wiring (field → where it's read)

A settings field is only meaningful once a consumer reads it. Wiring is being
migrated incrementally — each consumer reads its `GlobalSettings` section at
**layer build** (daemon restart picks up changes, consistent with the other
config-driven repos). Status:

- ✅ `git.{defaultBranch,remoteName}` → `sessions/files.repo` diff base, via the
  pure `gitBaseCandidates(git)` helper in `global-settings.core`. `FilesRepoLive`
  depends on `GlobalSettingsService`. The default (`origin`/`main`) yields the
  historical candidate list (`origin/main, origin/master, main, master, HEAD`)
  unchanged — verify with the core test before reordering.
- ⬜ `library.{catalogPath,agenticRepoPath}` → `library/library.repo`,
  `resolveAgenticRepoPath` (currently env: `PID_LIBRARY_DIR`,
  `PID_AGENTIC_REPO_PATH`).
- ⬜ `orchestration.{claudeBin,defaultAgent,defaultPermissionMode,defaultEffort,maxParallel}`
  → `platform/shell.repo` spawn cmd + `features/dispatch`.
- ⬜ `network.{projectsRoot,appPort,tunnelPort}` → `platform/config.repo`
  `ConfigService` (currently env: `PID_PROJECTS_ROOT`, `PORT`, `PID_TUNNEL_PORT`).
  Precedence target: explicit env var > settings file > default.

When wiring a new consumer: depend on `GlobalSettingsService`, read the relevant
section in the `Layer.effect` build, keep the default value identical to the
current hard-coded constant so existing tests stay green, then add a test that
the configured value flows through.
