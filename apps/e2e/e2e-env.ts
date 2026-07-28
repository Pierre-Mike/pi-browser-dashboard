// Shared between global-setup (which passes it to the daemon) and
// global-teardown (which reaps what carries it). It must be one constant in one
// place: the setup value lives in the daemon's spawn env, so a teardown reading
// `process.env.PID_ZELLIJ_PREFIX` sees nothing and silently reaps nothing.
//
// Every zellij session an e2e daemon derives is namespaced with this, so a test
// run cannot attach to — or create, or kill — the developer's real `default` /
// `Orchestrator` / `<repo>` sessions. See PID_ZELLIJ_PREFIX in
// apps/daemon/src/platform/config.io.ts.
export const E2E_ZELLIJ_PREFIX = "e2e"
