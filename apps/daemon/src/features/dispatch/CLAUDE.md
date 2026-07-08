# features/dispatch

## Expertise

Routes POST /dispatch to one of two spawn harnesses: `claude --bg` (ShellRepo,
supervisor-managed) and `pi -p` (PiRepo, detached child the daemon launches
itself). Pure request parsing in dispatch.core.ts, pi argv/output parsing in
pi.core.ts, side effects in pi.repo.ts / platform/shell.repo.ts.

### References

- [Gotchas](expertise-refs/gotchas.md) — pi launch failure modes and detached-spawn traps

### Related Domains
