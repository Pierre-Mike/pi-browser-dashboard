# features/excalidraw — expertise

## Expertise

Brainstorm V2: an embedded Excalidraw editor live-bound to a native
`<project>/.pid/brainstorms/<id>.excalidraw` document, plus a single plain AI
session (marker `[excalidraw:<slug>]`, no role missions — deliberate product
decision). Sync rides the daemon's codec-generic doc rooms; the daemon never
decodes elements, so the browser owns all element-level normalization.

### References

- [Gotchas](expertise-refs/gotchas.md) — Excalidraw 0.18 integration traps (ESM/CSS/types, restoreElements boundary, element-key dedupe)

### Related Domains

- `apps/web/src/features/canvas` — V1 React-Flow canvas + shared ws-url helpers
- `apps/daemon/src/features/canvas` — doc-room factory + Excalidraw codec
