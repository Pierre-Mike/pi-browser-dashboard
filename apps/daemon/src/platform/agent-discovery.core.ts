// How a session this daemon spawns learns that this daemon exists.
//
// The orchestration surface (`pid`, POST /sessions/:id/wait, /keys, /explain,
// fleet recipes, GET /agent-skill.md) was unreachable from inside a spawned
// session: nothing told the session which port the daemon bound, and nothing
// put the `pid` binary anywhere the session could find it. This module builds
// the two carriers for that, as plain data:
//
//   - `env`      — PID_URL / PID_SKILL_URL / PID_BIN, the names the `pid` CLI
//                  and the agent skill already document.
//   - `pointer`  — one opt-in sentence (default OFF) naming the skill url, for
//                  the `claude --append-system-prompt` flag. The user's own
//                  prompt is never touched.
//
// The two spawn paths need different carriers, because they hand off very
// differently:
//
//   - `claude --bg` (platform/shell.io.ts) does NOT run the session as its
//     child — the supervisor claims a PRE-WARMED `claude bg-spare` process
//     whose environment predates the dispatch, so a child env we set here is
//     dropped on the floor. Verified live: a var set on the `claude --bg`
//     invocation is invisible inside the session; the same var passed as
//     `--settings '{"env":{…}}'` is visible, and the supervisor records the
//     flag in `respawnFlags`, so it survives a respawn too. Hence
//     `claudeDiscoveryFlags`.
//   - a pi dispatch (features/dispatch/pi.io.ts) spawns its own zellij session
//     with an env this daemon builds byte-for-byte, so ordinary env works —
//     including a PATH prepend, which is what makes the bare name `pid`
//     resolve in that pane. Hence `discoveryChildEnv`.
//
// PATH deliberately has no claude-side equivalent: settings `env` values are
// literal (verified — `${PATH}` arrives as the four characters `${PA…`), so
// the only way to put a shim dir on a claude session's PATH would be to
// overwrite the whole variable with a value this daemon guessed. That would
// change an existing spawn's behaviour, so PID_BIN's absolute path is the
// contract there instead.

export type AgentDiscovery = {
  /** Env vars every spawned session should see. */
  readonly env: Readonly<Record<string, string>>
  /** Directory holding the `pid` shim, when one was written — PATH-prependable. */
  readonly shimDir?: string
  /** Opt-in pointer sentence, when the daemon was configured to add one. */
  readonly pointer?: string
}

export type DiscoveryUrls = {
  /** Root url of the running daemon, e.g. `http://localhost:8787`. */
  readonly baseUrl: string
  /** `""` for the dev daemon layout, `"/__api"` for the single-port CLI one. */
  readonly apiPrefix: string
}

/**
 * The base url a spawned session should talk to. Takes the port the daemon
 * actually bound (Bun's `server.port`), so `--port 9000` and `port: 0` are
 * both correct — a configured port would be a guess.
 */
export const discoveryBaseUrl = ({ port }: { readonly port: number }): string =>
  `http://localhost:${port}`

/**
 * Where GET /agent-skill.md really answers. `api.ts`'s `buildApp(staticDir)`
 * moves the whole API behind `/__api` when it serves the SPA at the root, and
 * the static app 404s an unknown path rather than falling back — so the bare
 * path is NOT a valid skill url in that layout.
 */
export const discoverySkillUrl = ({ baseUrl, apiPrefix }: DiscoveryUrls): string =>
  `${baseUrl}${apiPrefix}/agent-skill.md`

// One sentence, and only what an agent cannot infer: where the contract is and
// what to run. Literal values, not `$VAR` references — a system prompt is not
// shell-expanded.
const pointerLine = ({
  skillUrl,
  pidBin,
}: {
  readonly skillUrl: string
  readonly pidBin: string | undefined
}): string => {
  const how =
    pidBin === undefined
      ? `its HTTP surface is documented there`
      : `the \`pid\` CLI that drives it is at ${pidBin}`
  return `This session is mirrored by a pi-browser-dashboard daemon that can spawn, watch and answer other sessions on your behalf. Its contract is served at ${skillUrl} (fetch it before orchestrating anything); ${how}. The same values are in your environment as PID_SKILL_URL, PID_URL and PID_BIN.`
}

export type BuildDiscoveryInput = DiscoveryUrls & {
  /** Absolute path to a runnable `pid`, when the daemon resolved one. */
  readonly pidBin?: string
  /** Directory of `pidBin`, when a shim was written. */
  readonly shimDir?: string
  /** Add the prompt pointer (opt-in; `PID_AGENT_POINTER`). */
  readonly withPointer: boolean
}

/** Assemble what every spawn path then carries in its own way. */
export const buildDiscovery = ({
  baseUrl,
  apiPrefix,
  pidBin,
  shimDir,
  withPointer,
}: BuildDiscoveryInput): AgentDiscovery => {
  const skillUrl = discoverySkillUrl({ baseUrl, apiPrefix })
  return {
    env: {
      PID_URL: baseUrl,
      PID_SKILL_URL: skillUrl,
      ...(pidBin === undefined ? {} : { PID_BIN: pidBin }),
    },
    ...(shimDir === undefined ? {} : { shimDir }),
    ...(withPointer ? { pointer: pointerLine({ skillUrl, pidBin }) } : {}),
  }
}

/**
 * Extra `claude --bg` flags that carry discovery into a supervisor-spawned
 * session. Empty for an unarmed daemon, so a dispatch is byte-identical to
 * what it was before this existed.
 */
export const claudeDiscoveryFlags = (discovery: AgentDiscovery | undefined): string[] => {
  if (discovery === undefined) return []
  const settings = ["--settings", JSON.stringify({ env: discovery.env })]
  if (discovery.pointer === undefined) return settings
  return [...settings, "--append-system-prompt", discovery.pointer]
}

const PATH_SEP = ":"

// Prepend once: re-arming, or a session spawned from a session, must not grow
// PATH by one copy of the shim dir per hop.
const pathWithShimDir = ({
  path,
  shimDir,
}: {
  readonly path: string | undefined
  readonly shimDir: string
}): string => {
  if (path === undefined || path.length === 0) return shimDir
  if (path === shimDir || path.startsWith(`${shimDir}${PATH_SEP}`)) return path
  return `${shimDir}${PATH_SEP}${path}`
}

/**
 * Env for a child this daemon spawns itself (the pi zellij session): the env
 * it would have had, plus the discovery vars, plus the shim dir on PATH so the
 * bare name `pid` resolves in that pane. An unarmed daemon returns the input
 * unchanged.
 */
export const discoveryChildEnv = ({
  env,
  discovery,
}: {
  readonly env: Readonly<Record<string, string>>
  readonly discovery: AgentDiscovery | undefined
}): Record<string, string> => {
  if (discovery === undefined) return { ...env }
  const merged: Record<string, string> = { ...env, ...discovery.env }
  if (discovery.shimDir === undefined) return merged
  return {
    ...merged,
    PATH: pathWithShimDir({ path: env.PATH, shimDir: discovery.shimDir }),
  }
}

// POSIX single-quote escape: wrap in single quotes, replace embedded ' with
// '\''. Total for any byte string in a POSIX shell (same helper, same reason,
// as features/dispatch/pi.core.ts's launcher script).
const shq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`

/**
 * The `pid` shim: a two-line `/bin/sh` script that execs whatever invocation
 * this install shape needs (`bun <repo>/apps/cli/src/agent/main.ts` from
 * source, `bun <bundle>/agent/main.js` for the packed CLI, or an already
 * installed `pid`) and forwards its arguments. One stable absolute path for a
 * session to run, whichever shape the daemon is running in.
 */
export const pidShimScript = ({ argv }: { readonly argv: readonly string[] }): string =>
  [
    "#!/bin/sh",
    "# Generated by the pi-browser-dashboard daemon (platform/agent-discovery.io.ts).",
    "# Rewritten on every daemon boot — edit the daemon, not this file.",
    `exec ${argv.map(shq).join(" ")} "$@"`,
    "",
  ].join("\n")
