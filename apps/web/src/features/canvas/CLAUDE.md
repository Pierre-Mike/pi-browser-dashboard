# apps/web/src/features/canvas — expertise

## Expertise

Shared React Flow canvas. Its one target is a brainstorm **board** — any
`*.canvas` / `*.canvas.json` file in a session's worktree — reached through the
drill-in's Brainstorm section (`features/brainstorms`). There is no session
scratch canvas: the old Canvas dock tab edited `~/.claude/jobs/<short>/canvas.json`,
a file outside the tree the agent works in, and a board in the worktree covers
the same need with a file the agent can actually see. Live-syncs over a websocket
doc room (`useCanvasSync` ↔ daemon `canvas.io`); files on disk are the source of
truth and the session's agent writes them directly. `canvasBriefing.ts` builds
the message that tells that agent where the file is *and which shape to write* —
three shapes now, since the two canvas encodings look identical on the wire and
Excalidraw's is a third thing entirely. The **button** that sends it does not
live here: it is `features/brainstorms/BriefAgentButton`, rendered once above
whichever editor the board opened in, because an Excalidraw board needs the same
button and duplicating it per editor meant a board could have two. This toolbar
therefore has no "Brief AI", and `CanvasDocTarget` carries no `format`. Edge
naming/editing lives in `EdgeLabel.tsx` (`LabeledEdge` overrides React Flow's
default edge type).

### References

- [Gotchas](expertise-refs/gotchas.md) — sync field-dropping, fitView e2e geometry

### Related Domains
