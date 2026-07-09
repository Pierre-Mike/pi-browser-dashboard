import { tmpdir } from "node:os"
import { join } from "node:path"
import { Context, Effect, Layer } from "effect"
import { resolveSpawnCwd, runCommand, ShellError } from "../../platform/shell.repo"
import { sseBus } from "../../platform/sse-bus"
import { buildPiDispatchArgs, type PiModel, parsePiModels, piLaunchFailureMessage } from "./pi.core"
import { type PiSessionsApi, PiSessionsRepo } from "./pi-sessions.repo"

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

// A launched child that outlived the window (or exited 0): the handle the
// dispatcher needs to track the run — its pid for liveness probes and the
// exit promise for a completion signal while the daemon stays up.
export type LaunchHandle = {
  readonly pid: number
  readonly exited: Promise<number>
}

// pi has no supervisor equivalent to `claude --bg` (which prints a short id
// and returns immediately), so a pi dispatch is a detached fire-and-forget
// child. Fire-and-forget must not mean fail-silently: watch the child through
// a short launch window and turn an immediate non-zero exit (missing API key,
// unknown flag) into a typed failure carrying pi's stderr, instead of minting
// a session id for a run that never happened.
export const spawnLaunchChecked = (
  input: LaunchCheckedInput,
): Effect.Effect<LaunchHandle, ShellError> =>
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
        return { pid: proc.pid, exited: proc.exited }
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

export const PiRepoLive: Layer.Layer<PiRepo, never, PiSessionsRepo> = Layer.effect(
  PiRepo,
  Effect.gen(function* () {
    const piSessions = yield* PiSessionsRepo
    return {
      dispatch: (input) =>
        Effect.gen(function* () {
          const sessionId = crypto.randomUUID()
          const cwd = resolveSpawnCwd(input.cwd, process.env)
          const args = buildPiDispatchArgs({
            intent: input.intent,
            sessionId,
            thinking: input.thinking,
            model: input.model,
            tools: input.tools,
          })
          const handle = yield* spawnLaunchChecked({
            cmd: args,
            cwd,
            stderrPath: join(tmpdir(), `pid-pi-launch-${sessionId}.log`),
            windowMs: LAUNCH_WINDOW_MS,
          })
          // Record the run so it shows up as a session card, and push its
          // lifecycle over SSE: created now, a state refresh when the child
          // exits (post-restart liveness falls back to pid/transcript probes
          // on each list()).
          piSessions.record({
            id: sessionId,
            pid: handle.pid,
            cwd,
            intent: input.intent,
            spawnedAt: new Date().toISOString(),
          })
          publishPiSession({ piSessions, sessionId, type: "session.created" })
          const publishExit = () =>
            publishPiSession({ piSessions, sessionId, type: "session.state" })
          handle.exited.then(publishExit, publishExit)
          return sessionId
        }),
      listModels: () =>
        runCommand({ cmd: ["pi", "--list-models"], timeoutMs: LIST_MODELS_TIMEOUT_MS }).pipe(
          Effect.map(({ stdout }) => parsePiModels(stdout)),
        ),
    }
  }),
)

const publishPiSession = ({
  piSessions,
  sessionId,
  type,
}: {
  piSessions: PiSessionsApi
  sessionId: string
  type: "session.created" | "session.state"
}): void => {
  const session = piSessions.getOne(sessionId)
  if (session) sseBus.publish({ type, data: session })
}
