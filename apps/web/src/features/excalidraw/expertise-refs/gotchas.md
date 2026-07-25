---
domain: features/excalidraw
updated: 2026-07-25
updated_by: claude (brainstorm-v2 layout fix)
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

- **EXC-G005: an Excalidraw column in a flex row MUST have `min-w-0`**
  confidence: 0.9 | added: 2026-07-25
  Excalidraw's intrinsic content width is ~1500px, so a flex item wrapping it
  keeps `min-width: auto` at that size and refuses to shrink to the row: the
  editor grew to 1550px on a 1440px viewport, pushed the companion panel off
  the right edge and left the page with a horizontal scrollbar. `flex-1` alone
  is not enough — pair it with `min-w-0` (and `overflow-hidden` on the row).
  Side panels docked next to it should be shrinkable rather than `shrink-0`,
  since the editor column's flex basis is 0 and absorbs no negative free space.
  Regression covered in `apps/e2e/tests/brainstorms-v2.spec.ts`.

- **EXC-G006: Excalidraw owns all four canvas corners — no overlay badges**
  confidence: 0.8 | added: 2026-07-25
  Menu top-left, shapes island top-centre, Library top-right, zoom/undo
  bottom-left, help bottom-right. An absolutely positioned sync badge at
  `right-2 top-2` sat on top of the Library button; the status strip lives in a
  header row above the editor instead. Also note Excalidraw switches to its
  compact/mobile UI when its **container** (not the window) is under ~730px, so
  a narrow column silently relocates its toolbars.

- **EXC-G004: text inside the drawing is NOT in the DOM**
  confidence: 0.6 | added: 2026-07-23
  Excalidraw renders to `<canvas>`; e2e cannot assert drawn labels with
  `getByText` (unlike the V1 React-Flow canvas). Assert the sync badge
  (`excalidraw-status` → "live"), the `.excalidraw` root, and daemon
  round-trips instead.
