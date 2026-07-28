# apps/daemon/src/features/brainstorms — expertise

## Expertise

Discovers the drawing files in **one session's worktree** (`worktreePath ??
cwd`), by suffix over the whole tree — never by scanning a blessed directory.
Three formats, one wire shape: `*.canvas` (Obsidian JSON Canvas), `*.canvas.json`
(legacy React-Flow, read/write but never created) and `*.excalidraw` both decode
to the canvas slice's `CanvasSnapshot`, so the socket and the browser editor are
shared and only the bytes on disk differ.

A board's identity is its worktree-relative path, carried in `?path=` on the doc
routes and in `?tab=brainstorm:<encoded path>` in the UI — so moving a board is a
`git mv`. New boards default to `brainstorms/<name>.canvas`; nothing depends on
them staying there.

The shell is plain async functions over an already-resolved root (mirrors
`projects/fileBrowser.io`), not an Effect service: once the router has resolved
*which* tree, there is no dependency left to inject. `api.ts` passes
`sessionsRoute.resolveSessionRoot` in, so this slice never imports the sessions
slice.

### References

- [Gotchas](expertise-refs/gotchas.md) — why session-scoped, suffix-order and briefing-format traps

### Related Domains

- `apps/daemon/src/features/canvas` — codecs + path-keyed doc rooms (the room door is `canvas.io`)
- `apps/web/src/features/brainstorms` — the drill-in's Brainstorm tab and boards rail
