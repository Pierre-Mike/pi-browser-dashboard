# features/excalidraw — expertise

## Expertise

An embedded Excalidraw editor live-bound to a native `*.excalidraw` file
**anywhere in the session's worktree**, addressed by its worktree-relative path
(`useExcalidrawSync({ short, path })`). There is no companion to spawn: the
session you are drilled into is the agent, and its terminal is docked beside the
editor. Sync rides the daemon's codec-generic doc rooms; the daemon never decodes
elements, so the browser owns all element-level normalization.

### References

- [Gotchas](expertise-refs/gotchas.md) — Excalidraw 0.18 integration traps (ESM/CSS/types, restoreElements boundary, element-key dedupe)

### Related Domains

- `apps/web/src/features/canvas` — React-Flow canvas + shared ws-url helpers
- `apps/daemon/src/features/canvas` — doc-room factory + Excalidraw codec
- `apps/daemon/src/features/brainstorms` — board discovery and why it is session-scoped
