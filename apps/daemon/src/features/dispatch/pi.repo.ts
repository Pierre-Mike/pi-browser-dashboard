import { Context, Effect, Layer } from "effect"
import { resolveSpawnCwd, runCommand, ShellError } from "../../platform/shell.repo"
import { buildPiDispatchArgs, type PiModel, parsePiModels } from "./pi.core"

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

// pi has no supervisor equivalent to `claude --bg` (which prints a short id
// and returns immediately), so a pi dispatch is a detached fire-and-forget
// child: spawn, unref, and hand back the session id we minted for it. pi
// persists the transcript under that id, so the run stays inspectable and
// resumable after the daemon restarts.
const spawnDetached = (cmd: readonly string[], cwd: string): Effect.Effect<void, ShellError> =>
  Effect.try({
    try: () => {
      const proc = Bun.spawn({
        cmd: [...cmd],
        cwd,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      })
      proc.unref()
    },
    catch: (cause) => new ShellError({ message: `spawn failed: ${cmd.join(" ")}`, cause }),
  })

const LIST_MODELS_TIMEOUT_MS = 30_000

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
      yield* spawnDetached(args, resolveSpawnCwd(input.cwd, process.env))
      return sessionId
    }),
  listModels: () =>
    runCommand({ cmd: ["pi", "--list-models"], timeoutMs: LIST_MODELS_TIMEOUT_MS }).pipe(
      Effect.map(({ stdout }) => parsePiModels(stdout)),
    ),
})
