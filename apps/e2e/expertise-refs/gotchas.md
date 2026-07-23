---
domain: apps/e2e
updated: 2026-07-23
updated_by: claude (brainstorm-v2 build)
---

# Gotchas

- **E2E-G001: pre-push e2e runs REAL claude spawns; CI runs the stub**
  confidence: 0.6 | added: 2026-07-23
  `scripts/check-e2e.sh` → `bun run test:e2e` with no stub env, so ~19 specs
  that spawn/drive real sessions (spawn-complete, drill-in, peek, send-keys,
  canvas-edit, sse-reconnect…) take ~28 min and can mass-fail when run from
  inside another Claude session or under quota pressure. The PR gate
  (`pr-e2e.yml`) sets `CI=true`, which forces the stub (~1.5 min, deterministic).
  Before blaming a diff: re-run with `PID_E2E_USE_STUB=1` — if that's green,
  the branch matches what CI checks, and `SKIP_E2E=1 git push` is the
  documented broken-env bypass.
