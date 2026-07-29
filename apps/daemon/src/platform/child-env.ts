// The environment this daemon hands to a child process it spawns.
//
// Lives in platform/ rather than in the terminal slice, and has no imports at
// all, for one structural reason: `config.io.ts` is the single place allowed to
// read the environment, and it needs this scrub to build the value it hands
// out (`childEnv`). A helper the config funnel depends on cannot live inside a
// feature slice — that would point platform at a feature, and it would put the
// dispatch slice's use of it (features/dispatch/pi.io.ts) through the terminal
// slice's internals for no reason other than where the function happened to be
// written first.
//
// Drop the per-session markers ZELLIJ / ZELLIJ_SESSION_NAME / ZELLIJ_PANE_ID
// before forwarding env to a child. If the daemon runs inside a zellij pane
// (common in dev) those vars leak and `zellij attach <same-name>` panics with
// "trying to attach to the current session".
//
// Keep ZELLIJ_SOCKET_DIR (and any other ZELLIJ_* config paths) untouched — the
// child needs them to talk to the user's zellij daemon. Stripping them sends
// the child to a different socket dir where it sees zero sessions.
const ZELLIJ_SESSION_KEYS = new Set(["ZELLIJ", "ZELLIJ_SESSION_NAME", "ZELLIJ_PANE_ID"])

export const cleanZellijEnv = (
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) continue
    if (ZELLIJ_SESSION_KEYS.has(k)) continue
    out[k] = v
  }
  return out
}
