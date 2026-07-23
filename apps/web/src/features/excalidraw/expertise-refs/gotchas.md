---
domain: features/excalidraw
updated: 2026-07-23
updated_by: claude (brainstorm-v2 build)
---

# Gotchas

- **EXC-G001: Excalidraw 0.18 is pure ESM with root-level exports — no Vite shims**
  confidence: 0.6 | added: 2026-07-23
  No `process.env.IS_PREACT` define, no font copying needed (assets fall back
  to CDN unless `window.EXCALIDRAW_ASSET_PATH` is set). Import the component
  from the root, styles via `@excalidraw/excalidraw/index.css`, and types via
  the subpath `@excalidraw/excalidraw/types` (the exports map routes `./*` to
  `dist/types/excalidraw/*.d.ts`). `restoreElements` is exported from the root.

- **EXC-G002: sanitize agent-written scenes with Excalidraw's own restoreElements**
  confidence: 0.6 | added: 2026-07-23
  Agents write partial/minimal element objects. Feeding them straight into
  `updateScene` renders broken scenes; `restoreElements(elements, null)` fills
  every missing field. This is the ONE place wire JSON crosses into Excalidraw
  types (single cast) — keep it that way.

- **EXC-G003: dedupe sync by element key, not document key**
  confidence: 0.6 | added: 2026-07-23
  Excalidraw's `onChange` fires on viewport/selection churn with unchanged
  elements. `useExcalidrawSync` keys the wire state on
  `JSON.stringify(doc.elements)` so zoom/scroll never hits the wire, and a
  remote apply's follow-up `onChange` doesn't echo back to the daemon.

- **EXC-G004: text inside the drawing is NOT in the DOM**
  confidence: 0.6 | added: 2026-07-23
  Excalidraw renders to `<canvas>`; e2e cannot assert drawn labels with
  `getByText` (unlike the V1 React-Flow canvas). Assert the sync badge
  (`excalidraw-status` → "live"), the `.excalidraw` root, and daemon
  round-trips instead.
