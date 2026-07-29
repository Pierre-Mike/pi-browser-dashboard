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

## Shape lives in `shared/`, policy lives here

`GlobalSettings` is an effect `Schema` in `shared/src/global-settings.ts`, because
`apps/web` edits the same document. It used to be declared twice — here, and by
hand in `apps/web/src/features/global-settings/types.ts` under a comment reading
"Mirrors apps/daemon/…". That is the `SessionState` / `Project` defect again, and
the web copy was already drifting in kind: it re-spelled each nested section
inline instead of naming it, so a section could gain a field with nothing left to
disagree with it. `apps/web` now decodes responses with `decodeGlobalSettings`
and the local `globalSettings.parse.ts` guard is gone.

What stays in this slice is the **policy**: `DEFAULT_GLOBAL_SETTINGS` and the
per-field readers. A default is an opinion the file's owner holds (`~/Github`,
port 8787), not a shape both ends must agree on, and the web app never needs one
— it renders whatever the daemon resolved. `serializeGlobalSettings` is asserted
against `decodeGlobalSettings` in the core test, so a field added to the defaults
without being added to the contract fails as an excess property.

Plus one list, not a section: `skillGroups` — named `{name, skills[]}` presets
the web spawn modal applies in one click (and saves the current selection into).
Unlike the object sections, a PATCH that includes `skillGroups` **replaces the
whole list** (omitting it leaves the stored set untouched); entries are
sanitized field-by-field in `readSkillGroups` (blank/duplicate name dropped,
name is the dedupe key, `skills` coerced to `[]` and deduped/trimmed). The
routes allowlist passes the array through (`toPatch`), since it isn't an object
section. Consumed only in the web client (`dispatch/useSpawnSkills` +
`global-settings` panel list/delete) — no daemon-side reader.

## Consumer wiring (field → where it's read)

A settings field is only meaningful once a consumer reads it. Wiring is being
migrated incrementally — each consumer reads its `GlobalSettings` section at
**layer build** (daemon restart picks up changes, consistent with the other
config-driven repos). Status:

- ✅ `git.{defaultBranch,remoteName}` → `sessions/files.repo` diff base, via the
  pure `gitBaseCandidates(git)` helper in `global-settings.core`. `FilesIoLive`
  depends on `GlobalSettingsService`. The default (`origin`/`main`) yields the
  historical candidate list (`origin/main, origin/master, main, master, HEAD`)
  unchanged — verify with the core test before reordering.
- ⬜ `library.{catalogPath,agenticRepoPath}` → `library/library.repo`,
  `resolveAgenticRepoPath` (currently env: `PID_LIBRARY_DIR`,
  `PID_AGENTIC_REPO_PATH`).
- ⬜ `orchestration.{claudeBin,defaultAgent,defaultPermissionMode,defaultEffort,maxParallel}`
  → `platform/shell.io` spawn cmd + `features/dispatch`.
- ⬜ `network.{projectsRoot,appPort,tunnelPort}` → `platform/config.repo`
  `ConfigService` (currently env: `PID_PROJECTS_ROOT`, `PORT`, `PID_TUNNEL_PORT`).
  Precedence target: explicit env var > settings file > default.

When wiring a new consumer: depend on `GlobalSettingsService`, read the relevant
section in the `Layer.effect` build, keep the default value identical to the
current hard-coded constant so existing tests stay green, then add a test that
the configured value flows through.
