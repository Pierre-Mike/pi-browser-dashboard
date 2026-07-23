# apps/web/src/features/canvas — expertise

## Expertise

Shared React Flow canvas (session scratch canvas + project brainstorms).
Live-syncs over a websocket doc room (`useCanvasSync` ↔ daemon
`canvas.repo`); files on disk are the source of truth and AI companions
write them directly. Edge naming/editing lives in `EdgeLabel.tsx`
(`LabeledEdge` overrides React Flow's default edge type).

### References

- [Gotchas](expertise-refs/gotchas.md) — sync field-dropping, fitView e2e geometry

### Related Domains
