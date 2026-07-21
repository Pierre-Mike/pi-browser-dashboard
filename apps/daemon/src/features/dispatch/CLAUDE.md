# features/dispatch

## Expertise

Routes POST /dispatch to one of two spawn harnesses: `claude --bg` (ShellRepo,
supervisor-managed) and `pi` (PiRepo). pi runs INTERACTIVELY inside a detached
`pi-<short>` zellij session (`zellij -n <layout> attach -b`) so the dashboard
terminal can attach to a live run — the terminal `/:id` route falls back to
PiSessionsRepo and builds `zellij attach pi-<short>` (see terminal.core
`sessionPiZellijCommand`). Pure request parsing in dispatch.core.ts, pi
argv/launcher/verdict builders in pi.core.ts, side effects in pi.repo.ts /
platform/shell.repo.ts.

### References

- [Gotchas](expertise-refs/gotchas.md) — pi launch failure modes and detached-spawn traps

### Related Domains
