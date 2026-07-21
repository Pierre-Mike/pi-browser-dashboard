// Mirrors `buildDispatchArgs` in apps/daemon/src/platform/shell.repo.ts so the
// spawn modal can show the exact `claude --bg ...` argv the daemon will run.
// Duplicated rather than imported: web only consumes the daemon's RPC types
// (`@pid/daemon/types`), never its runtime modules, so the two stay
// independently deployable — see apps/web/src/lib/types.ts for the same
// convention applied to SessionState.

export type SpawnCommandPreviewInput = {
  readonly intent: string
  readonly effort?: string
  readonly model?: string
  readonly tools?: readonly string[]
}

export const buildSpawnCommandArgs = ({
  intent,
  effort,
  model,
  tools,
}: SpawnCommandPreviewInput): string[] => {
  const args: string[] = ["claude", "--bg"]
  if (effort) args.push("--effort", effort)
  if (model) args.push("--model", model)
  if (tools !== undefined) args.push("--tools", tools.join(","), "--")
  args.push(intent)
  return args
}

export type PiSpawnCommandPreviewInput = {
  readonly intent: string
  readonly thinking?: string
  readonly model?: string
  readonly tools?: readonly string[]
}

// Mirrors `buildPiRunArgv` in apps/daemon/src/features/dispatch/pi.core.ts
// (same duplication convention as above). The daemon runs pi INTERACTIVELY
// (no `-p`) inside a detached `pi-<short>` zellij session so the terminal can
// attach; the intent is a trailing positional message. The daemon additionally
// injects a `--session-id <uuid>` it mints at dispatch time — unknowable here,
// so the preview shows everything but that flag.
export const buildPiSpawnCommandArgs = ({
  intent,
  thinking,
  model,
  tools,
}: PiSpawnCommandPreviewInput): string[] => {
  const args: string[] = ["pi"]
  if (thinking) args.push("--thinking", thinking)
  if (model) args.push("--model", model)
  if (tools !== undefined) {
    if (tools.length === 0) args.push("--no-tools")
    else args.push("--tools", tools.join(","))
  }
  args.push(intent)
  return args
}

// Only these characters are safe to display unquoted in a shell command line.
const SAFE_ARG_RE = /^[A-Za-z0-9,._/@%+=:-]+$/

// Shell-quotes one argv entry for display purposes only (this never runs a
// shell — the daemon spawns argv directly). Empty strings are quoted too so a
// deliberate `--tools ''` doesn't visually disappear.
const quoteArg = (arg: string): string =>
  SAFE_ARG_RE.test(arg) ? arg : `'${arg.replace(/'/g, "'\\''")}'`

export const formatSpawnCommand = (args: readonly string[]): string => args.map(quoteArg).join(" ")
