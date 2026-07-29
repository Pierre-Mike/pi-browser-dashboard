# Canvas gotchas

- **CAN-G001: Sync mappers silently drop any field they don't copy**
  confidence: 0.6 | added: 2026-07-23
  The wire↔React-Flow mappings (`snapshotToReactFlow` / `reactFlowToSnapshot`
  in `canvasSync.ts`) copy fields explicitly. Anything not listed vanishes on
  the next sync echo — this is how edge `data` (arrow direction, color) got
  lost for months while `label` survived. When adding a field to
  `CanvasSnapshot`, add it to BOTH mappers and to the round-trip test in
  `canvasSync.test.ts`; the daemon's `parseCanvas` (canvas.core.ts) must also
  list it or the file write drops it server-side.

- **CAN-G002: fitView zooms onto the first node — pane coordinates lie in e2e**
  confidence: 0.6 | added: 2026-07-23
  The canvas mounts empty (snapshot arrives async), so React Flow's `fitView`
  fires when the FIRST node appears and zooms hard onto it (≈2x). After that,
  `pane.dblclick({ position })` coordinates no longer map 1:1 to flow space;
  boxes land on top of each other. In Playwright, position nodes by dragging
  them to fractions of the pane's boundingBox, and locate them by text
  (`.react-flow__node`, { hasText }) instead of nth().

- **CAN-G004: the Brainstorm split view leaves the pane too narrow to aim at**
  confidence: 0.8 | added: 2026-07-29
  The editor's only surface is a brainstorm board, and that board shares its row
  with the boards rail (`w-48`) and the session's own terminal (~390px). At
  Playwright's default 1280px viewport the pane is ~370px wide, and two things
  break at once: `fitView` zooms one node past the pane edges (CAN-G002 squared),
  and React Flow's MiniMap (bottom-right, 200×150) plus Controls (bottom-left)
  cover so large a fraction that `pane.dblclick({ position })` at `fx/fy > ~0.6`
  is swallowed by an overlay — Playwright reports "subtree intercepts pointer
  events" and retries for the full timeout. `openSeededBoard` in
  `apps/e2e/tests/helpers.ts` therefore sets a 1600×1000 viewport and collapses
  the rail; keep drawing coordinates out of both bottom corners regardless.

- **CAN-G003: React Flow's bezier passes through the endpoint midpoint**
  confidence: 0.6 | added: 2026-07-23
  For the default bezier (right→left handles), the control points cancel at
  t=0.5, so the curve passes exactly through the midpoint of its two
  endpoints. To click "the line" in a test, compute that midpoint from the
  two node boundingBoxes — the bounding-box center of the edge's SVG group is
  NOT on the curve, and Playwright refuses `.react-flow__edge` clicks with
  "element is not visible". A miss lands on the pane and pane-double-click
  drops a new box that swallows subsequent typing.
