// Pure helpers for dispatching to the pi coding harness (the second spawn
// harness next to `claude --bg`). No I/O — pi.repo.ts shells out, this module
// parses and builds argv.

export type PiModel = {
  readonly provider: string
  readonly id: string
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI SGR escapes
const ANSI_RE = /\x1b\[[0-9;]*m/g

// Parse `pi --list-models` table output: one header line, then
// `<provider> <model-id> <context> ...` columns separated by whitespace.
// Rows without at least two columns are dropped rather than guessed at.
export const parsePiModels = (stdout: string): PiModel[] => {
  const lines = stdout.replace(ANSI_RE, "").split(/\r?\n/)
  const out: PiModel[] = []
  for (const line of lines.slice(1)) {
    const cols = line.trim().split(/\s+/)
    const [provider, id] = cols
    if (!provider || !id) continue
    out.push({ provider, id })
  }
  return out
}

export type PiDispatchArgsInput = {
  readonly intent: string
  // Exact pi session id (`--session-id`) so the daemon can hand the caller a
  // resumable handle. Omitted in the web command preview, where the id doesn't
  // exist yet.
  readonly sessionId?: string
  // pi has no --effort; its knob is `--thinking off|minimal|low|...|xhigh`.
  readonly thinking?: string
  // "provider/id" pattern, matching `pi --model` and the --list-models rows.
  readonly model?: string
  // Allow-list for `--tools` (comma-separated). Undefined = pi's own default
  // (every tool, omit the flag); empty = a deliberate `--no-tools`.
  readonly tools?: readonly string[]
}

// Message for a pi process that died during the launch window. pi reports
// startup problems ("No API key for provider: …", unknown flags) on stderr;
// when it exits silently the exit code is all we have.
export const piLaunchFailureMessage = (exitCode: number, stderr: string): string => {
  const detail = stderr.trim()
  return detail.length > 0 ? detail : `pi exited with code ${exitCode} before starting`
}

// Build the argv for an INTERACTIVE pi run — the shape the daemon now launches
// inside a zellij session so the terminal can attach to it. Same flags as a
// headless run minus `-p`, with the intent as a trailing positional message:
// pi processes it as the first user turn and then stays in the interactive TUI,
// which is exactly what makes the session attachable. None of the flag values
// are variadic (`--tools` takes one comma-separated arg), so the positional
// intent is never swallowed — no `--` terminator needed.
export const buildPiRunArgv = ({
  intent,
  sessionId,
  thinking,
  model,
  tools,
}: PiDispatchArgsInput): string[] => {
  const args: string[] = ["pi"]
  if (sessionId) args.push("--session-id", sessionId)
  if (thinking) args.push("--thinking", thinking)
  if (model) args.push("--model", model)
  if (tools !== undefined) {
    if (tools.length === 0) args.push("--no-tools")
    else args.push("--tools", tools.join(","))
  }
  args.push(intent)
  return args
}

// POSIX single-quote escape: wrap in single quotes, replace embedded ' with
// '\''. Total for any byte string in a POSIX shell — the one layer of quoting
// the launcher script needs (see buildPiLauncherScript).
const shq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`

export type PiLauncherInput = {
  // buildPiRunArgv output — the interactive pi invocation.
  readonly runArgv: readonly string[]
  // File the script writes pi's pid to (see below).
  readonly pidPath: string
  // File pi's stderr is redirected to — read during the launch window.
  readonly stderrPath: string
}

// The launcher script the pi background-session pane runs (`bash -l <script>`).
// Writing pi's invocation to a file the daemon controls byte-for-byte — rather
// than inlining it in the zellij layout KDL — sidesteps a two-layer escaping
// problem: an arbitrary user intent would otherwise have to survive BOTH a bash
// `-lc` string AND a KDL double-quoted string. As file content, one layer of
// single-quote escaping is total.
//
//   echo $$ > pid        bash's own pid, written before it is replaced. `exec`
//                        hands that pid to pi verbatim, so the recorded pid IS
//                        pi's — the liveness signal the session card derives
//                        state from (alive → working; gone → done/failed).
//   exec pi … 2> stderr  pi replaces bash and becomes the pane's sole process,
//                        so when pi exits the pane closes and the session ends
//                        (keeps the liveness probe honest). Startup errors — an
//                        unkeyed model dies in ~1s with "No API key for
//                        provider: …" — land in a file the daemon reads.
export const buildPiLauncherScript = ({ runArgv, pidPath, stderrPath }: PiLauncherInput): string =>
  [
    `echo $$ > ${shq(pidPath)}`,
    `exec ${runArgv.map(shq).join(" ")} 2> ${shq(stderrPath)}`,
    "",
  ].join("\n")

// argv for creating the pi background session: `zellij -n <layout> attach -b
// <name>`. `-b` (--create-background) makes a DETACHED session — no attached
// client — that still runs the layout's command, so pi starts working the
// instant dispatch returns and the terminal can attach whenever. `-n <layout>`
// is a top-level option, so it MUST precede the `attach` subcommand.
export const piBackgroundSessionArgv = (args: {
  readonly layoutPath: string
  readonly sessionName: string
}): string[] => ["zellij", "-n", args.layoutPath, "attach", "-b", args.sessionName]

export type PiLaunchProbe = {
  // pidfile contents, or undefined when the launcher never wrote it.
  readonly pidRaw: string | undefined
  // isPidAlive(parsed pid); false when the pid is unknown or unparseable.
  readonly pidAlive: boolean
  // pi's captured stderr.
  readonly stderr: string
}

export type PiLaunchVerdict =
  | { readonly ok: true; readonly pid: number }
  | { readonly ok: false; readonly message: string }

// Decide a dispatched pi run's fate after the launch window. pi lives inside a
// zellij pane now, so the daemon can't watch its exit directly — the launcher
// wrote pi's pid and stderr to files instead. A live pid means the run is
// going; a dead or absent pid means pi never got off the ground, so surface its
// stderr the same way the old detached-spawn path did (DIS-G001).
export const piLaunchVerdict = ({ pidRaw, pidAlive, stderr }: PiLaunchProbe): PiLaunchVerdict => {
  const pid = pidRaw ? Number.parseInt(pidRaw.trim(), 10) : Number.NaN
  if (Number.isFinite(pid) && pid > 0 && pidAlive) return { ok: true, pid }
  const detail = stderr.trim()
  return { ok: false, message: detail.length > 0 ? detail : "pi exited before starting" }
}
