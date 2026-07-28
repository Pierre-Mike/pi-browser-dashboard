# apps/web/src/features/canvas — expertise

## Expertise

Shared React Flow canvas, bound to either of two targets: a session's scratch
canvas (`~/.claude/jobs/<short>/canvas.json`) or a brainstorm **board** — any
`*.canvas` / `*.canvas.json` file in that same session's worktree. Live-syncs
over a websocket doc room (`useCanvasSync` ↔ daemon `canvas.io`); files on disk
are the source of truth and the session's agent writes them directly. "Brief AI"
tells that agent where the file is *and which shape to write*
(`canvasBriefing.ts` — the two encodings look identical on the wire). Edge
naming/editing lives in `EdgeLabel.tsx` (`LabeledEdge` overrides React Flow's
default edge type).

### References

- [Gotchas](expertise-refs/gotchas.md) — sync field-dropping, fitView e2e geometry

### Related Domains
