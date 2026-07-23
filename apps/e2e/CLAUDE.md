# apps/e2e — expertise

## Expertise

Playwright suite over a real daemon + Vite web server (global-setup boots
both). Two run modes: **stub** (`PID_E2E_USE_STUB=1`, and always on CI via
`CI=true`) fakes the `claude` binary; **real** (default locally, used by the
pre-push hook) spawns actual sessions.

### References

- [Gotchas](expertise-refs/gotchas.md) — stub vs real mode, pre-push gate mass-failures from nested sessions

### Related Domains
