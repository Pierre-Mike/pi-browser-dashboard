---
updated: 2026-07-21
updated_by: claude
---

# Dispatch gotchas

- **DIS-G001: pi dies instantly for a model whose provider has no API key**
  confidence: 0.6 | added: 2026-07-08 | updated: 2026-07-21
  `pi --list-models` (and GET /dispatch/pi-models) lists the FULL provider
  catalog, keyed or not. Picking a model without a configured key makes pi
  exit 1 within ~1s with stderr `No API key for provider: <name>`. pi now runs
  inside a detached zellij pane, so the daemon can't watch its exit directly:
  the launcher script writes pi's pid (`echo $$` before `exec pi`) and redirects
  pi's stderr to a file. After LAUNCH_WINDOW_MS, dispatch reads both — dead/
  absent pid + non-empty stderr → typed failure carrying that stderr
  (piLaunchVerdict in pi.core.ts). Same inline modal error as before, different
  mechanism.

- **DIS-G005: zellij can't deliver keys to a client-less background session**
  confidence: 0.8 | added: 2026-07-21
  `zellij attach -b <name>` creates a DETACHED session (verified: it DOES run
  the layout's `command` pane with no client attached). But `zellij --session
  <name> action write-chars` / `write` to that client-less session return exit 0
  and silently do NOTHING — no pane is focused without a client. So "create the
  session, then send keys from the daemon" is impossible; the pi run must be
  baked into the layout (a launcher script the pane runs), NOT typed in after.

- **DIS-G002: detached children must not inherit a stderr pipe**
  confidence: 0.6 | added: 2026-07-08
  If a long-lived detached child gets `stderr: "pipe"` and the daemon unrefs
  it without reading, the child can block once the 64KB pipe buffer fills.
  Point stderr at a file (`Bun.file(path)`) instead — readable after an
  early death, harmless for a survivor.

- ~~**DIS-G003: a pi dispatch has no dashboard presence after launch**~~
  *Superseded 2026-07-09: pi-sessions.repo.ts records every dispatch in
  `~/.pid/pi-spawns.json` (override: PID_PI_SPAWNS_FILE) and GET /sessions
  merges them as harness:"pi" cards. See DIS-G004.*

- **DIS-G004: pi session state is derived, not reported**
  confidence: 0.6 | added: 2026-07-09 | updated: 2026-07-21
  pi has no state.json. A pi card's state comes from probes on each list():
  transcript ends with an assistant message → done; else pid alive → working;
  else failed. pi encodes the *realpath* of the cwd into its session dir name
  (`/tmp` → `--private-tmp--`), so always realpath before encodePiSessionDir.
  The recorded pid is pi's OWN (the launcher's `echo $$; exec pi` hands the pane
  shell's pid to pi), so the pid probe stays accurate even though pi lives in a
  zellij pane. But there's no longer a `proc.exited` hook — the daemon can't see
  pi exit inside the pane — so the live working→done SSE edge is GONE for pi:
  states refresh on read only.
