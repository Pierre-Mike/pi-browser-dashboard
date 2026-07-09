---
updated: 2026-07-08
updated_by: claude
---

# Dispatch gotchas

- **DIS-G001: pi dies instantly for a model whose provider has no API key**
  confidence: 0.6 | added: 2026-07-08
  `pi --list-models` (and GET /dispatch/pi-models) lists the FULL provider
  catalog, keyed or not. Picking a model without a configured key makes
  `pi -p` exit 1 within ~1s with stderr `No API key for provider: <name>`.
  A blind detached spawn turns this into a silent no-op that looks like
  "spawning pi does not work". Dispatch must watch the launch window
  (see spawnLaunchChecked in pi.repo.ts) and forward that stderr.

- **DIS-G002: detached children must not inherit a stderr pipe**
  confidence: 0.6 | added: 2026-07-08
  If a long-lived detached child gets `stderr: "pipe"` and the daemon unrefs
  it without reading, the child can block once the 64KB pipe buffer fills.
  Point stderr at a file (`Bun.file(path)`) instead — readable after an
  early death, harmless for a survivor.

- **DIS-G003: a pi dispatch has no dashboard presence after launch**
  confidence: 0.6 | added: 2026-07-08
  The sessions registry only scans `~/.claude/jobs/` (claude supervisor).
  A successful pi run persists only under `~/.pi/agent/sessions/<encoded-cwd>/`
  and never appears as a session card; the uuid returned by POST /dispatch is
  a `pi --session <id>` resume handle, not a registry key.
