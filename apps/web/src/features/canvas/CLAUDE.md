# apps/web/src/features/canvas — expertise

## Expertise

Shared React Flow canvas. Its one target is a brainstorm **board** — any
`*.canvas` / `*.canvas.json` file in a session's worktree — reached through the
drill-in's Brainstorm section (`features/brainstorms`). There is no session
scratch canvas: the old Canvas dock tab edited `~/.claude/jobs/<short>/canvas.json`,
a file outside the tree the agent works in, and a board in the worktree covers
the same need with a file the agent can actually see. Live-syncs over a websocket
doc room (`useCanvasSync` ↔ daemon `canvas.io`); files on disk are the source of
truth and the session's agent writes them directly. "Brief AI" tells that agent
where the file is *and which shape to write* (`canvasBriefing.ts` — the two
encodings look identical on the wire). Edge naming/editing lives in
`EdgeLabel.tsx` (`LabeledEdge` overrides React Flow's default edge type).

### References

- [Gotchas](expertise-refs/gotchas.md) — sync field-dropping, fitView e2e geometry

### Related Domains
