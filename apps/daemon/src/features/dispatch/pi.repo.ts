import { tmpdir } from "node:os"
import { join } from "node:path"
import { Context, Effect, Layer } from "effect"
import { resolveSpawnCwd, runCommand, ShellError } from "../../platform/shell.repo"
import { buildPiDispatchArgs, type PiModel, parsePiModels, piLaunchFailureMessage } from "./pi.core"

export type PiDispatchInput = {
  readonly intent: string
  readonly cwd?: string
  readonly thinking?: string
  readonly model?: string
  readonly tools?: readonly string[]
}

export type PiRepoApi = {
  // Spawn a non-interactive pi run and return its session id — the handle the
  // user resumes with (`pi --session <id>`).
  readonly dispatch: (input: PiDispatchInput) => Effect.Effect<string, ShellError>
  readonly listModels: () => Effect.Effect<readonly PiModel[], ShellError>
}

export class PiRepo extends Context.Tag("PiRepo")<PiRepo, PiRepoApi>() {}

export type LaunchCheckedInput = {
  readonly cmd: readonly string[]
  readonly cwd: string
  // stderr goes to a file, not a pipe, so a surviving child never blocks on
  // an unread pipe after the daemon lets go of it.
  readonly stderrPath: string
  readonly windowMs: number
}

const readFileOrEmpty = async (path: string): Promise<string> => {
  try {
    return await Bun.file(path).text()
  } catch {
    return ""
  }
}

// pi has no supervisor equivalent to `claude --bg` (which prints a short id
// and returns immediately), so a pi dispatch is a detached fire-and-forget
// child. Fire-and-forget must not mean fail-silently: watch the child through
// a short launch window and turn an immediate non-zero exit (missing API key,
// unknown flag) into a typed failure carrying pi's stderr, instead of minting
// a session id for a run that never happened.
export const spawnLaunchChecked = (input: LaunchCheckedInput): Effect.Effect<void, ShellError> =>
  Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn({
        cmd: [...input.cmd],
        cwd: input.cwd,
        stdin: "ignore",
        stdout: "ignore",
        stderr: Bun.file(input.stderrPath),
      })
      const exitCode = await Promise.race([proc.exited, Bun.sleep(input.windowMs).then(() => null)])
      if (exitCode === null || exitCode === 0) {
        proc.unref()
        return
      }
      const stderr = await readFileOrEmpty(input.stderrPath)
      throw new ShellError({ message: piLaunchFailureMessage(exitCode, stderr), exitCode, stderr })
    },
    catch: (cause) =>
      cause instanceof ShellError
        ? cause
        : new ShellError({ message: `spawn failed: ${input.cmd.join(" ")}`, cause }),
  })

const LIST_MODELS_TIMEOUT_MS = 30_000
const LAUNCH_WINDOW_MS = 1_500

export const PiRepoLive: Layer.Layer<PiRepo> = Layer.succeed(PiRepo, {
  dispatch: (input) =>
    Effect.gen(function* () {
      const sessionId = crypto.randomUUID()
      const args = buildPiDispatchArgs({
        intent: input.intent,
        sessionId,
        thinking: input.thinking,
        model: input.model,
        tools: input.tools,
      })
      yield* spawnLaunchChecked({
        cmd: args,
        cwd: resolveSpawnCwd(input.cwd, process.env),
        stderrPath: join(tmpdir(), `pid-pi-launch-${sessionId}.log`),
        windowMs: LAUNCH_WINDOW_MS,
      })
      return sessionId
    }),
  listModels: () =>
    runCommand({ cmd: ["pi", "--list-models"], timeoutMs: LIST_MODELS_TIMEOUT_MS }).pipe(
      Effect.map(({ stdout }) => parsePiModels(stdout)),
    ),
})
