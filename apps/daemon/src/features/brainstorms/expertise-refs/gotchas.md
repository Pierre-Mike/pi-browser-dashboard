# Brainstorm gotchas

- **BRS-G001: A board must live in the session's own worktree or the agent's write is lost**
  confidence: 0.9 | added: 2026-07-28
  Boards used to hang off the project (`<project>/.pid/brainstorms/`) while the
  AI companion was a separately spawned session working in its *own* worktree.
  The companion was handed the project-absolute path, so its write either landed
  outside the tree it owned or was refused — and from the user's side the drawing
  simply never updated. The whole surface is session-scoped now for that one
  reason: root = `worktreePath ?? cwd`, so the file the browser renders is the
  file the agent can write. Do not reintroduce a project-scoped board list.

- **BRS-G002: `.canvas.json` must be matched before `.canvas`**
  confidence: 0.9 | added: 2026-07-28
  `x.canvas.json` ends with `.json`, not with `.canvas`, but a naive suffix loop
  ordered the other way round still classifies nothing wrong — the trap is the
  reverse: matching `.canvas` first on a path like `x.canvas.json` fails, yet a
  future `.canvas.gz`-style suffix would break silently. `KIND_SUFFIXES` in
  `brainstorms.core.ts` is ordered longest-first for exactly this; keep it that
  way and keep the "longer suffix wins" test.

- **BRS-G003: The briefing has to name the on-disk format, not just the path**
  confidence: 0.8 | added: 2026-07-28
  Both canvas encodings arrive at the browser as the same `CanvasSnapshot`, so
  the editor cannot tell an agent which shape to write — only the board's `kind`
  can. "Brief AI" therefore passes a `CanvasFormat`
  (`apps/web/src/features/canvas/canvasBriefing.ts`): a `.canvas` board gets the
  JSON Canvas shape (`nodes[].x/y`, `edges[].fromNode`), a `.canvas.json` board
  the React-Flow one (`position:{x,y}`, `source`/`target`). Describe the wrong
  one and the agent writes a file the room then refuses to decode, which surfaces
  as a dead board rather than an error.

- **BRS-G004: `.canvas` files carry no modification time — never stamp one in**
  confidence: 0.7 | added: 2026-07-28
  The React-Flow codec stamps `updatedAt` on publish; the JSON Canvas codec's
  `stamp` is identity and `jsonCanvasEqual` compares the *encoded document*, not
  the snapshot. Stamping would write a key Obsidian does not know and make every
  save look like an external content change, echoing back to every connected tab
  mid-drag.

- **BRS-G005: Discovery walks the whole tree, so it costs what the Files tab costs**
  confidence: 0.6 | added: 2026-07-28
  `listBrainstormsIn` reuses `treeAt` (skips `.git`, `node_modules`, `dist`, …,
  capped at `MAX_TREE_FILES`) and then stats only the matches. That is deliberate
  — it is the price of "any canvas file is a board" — but it means the list
  endpoint is O(tree). The web hook keeps a 5s `staleTime` for that reason; don't
  drop it to zero or poll it on an interval.
