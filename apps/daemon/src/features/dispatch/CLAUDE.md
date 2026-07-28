# features/dispatch

## Expertise

Routes POST /dispatch to one of two spawn harnesses: `claude --bg` (ShellIo,
supervisor-managed) and `pi` (PiIo). pi runs INTERACTIVELY inside a detached
`pi-<short>` zellij session (`zellij -n <layout> attach -b`) so the dashboard
terminal can attach to a live run — the terminal `/:id` route falls back to
PiSessionsIo and builds `zellij attach pi-<short>` (see terminal.core
`sessionPiZellijCommand`). Pure request parsing in dispatch.core.ts, pi
argv/launcher/verdict builders in pi.core.ts, side effects in pi.io.ts /
platform/shell.io.ts.

### References

- [Gotchas](expertise-refs/gotchas.md) — pi launch failure modes and detached-spawn traps

### Related Domains
