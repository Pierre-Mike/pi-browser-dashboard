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

export const buildPiDispatchArgs = ({
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
  args.push("-p", intent)
  return args
}
