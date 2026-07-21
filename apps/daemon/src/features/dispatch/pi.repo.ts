import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Context, Effect, Layer } from "effect"
import { resolveSpawnCwd, runCommand, ShellError } from "../../platform/shell.repo"
import { sseBus } from "../../platform/sse-bus"
import {
  cleanZellijEnv,
  piBackgroundLayoutKdl,
  piZellijSessionName,
} from "../terminal/terminal.core"
import {
  buildPiLauncherScript,
  buildPiRunArgv,
  type PiModel,
  parsePiModels,
  piBackgroundSessionArgv,
  piLaunchFailureMessage,
  piLaunchVerdict,
} from "./pi.core"
import { piShort } from "./pi-sessions.core"
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
  // Env for the child. Omit to inherit the daemon's env; the zellij spawn
  // passes cleanZellijEnv(process.env) so a daemon running inside a zellij pane
  // doesn't leak ZELLIJ_SESSION_NAME and trip self-attach detection.
  readonly env?: Record<string, string>
}

const readFileOrEmpty = async (path: string): Promise<string> => {
  try {
    return await Bun.file(path).text()
  } catch {
    return ""
  }
}

const readFileSyncOr = (path: string, fallback: string | undefined): string | undefined => {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return fallback
  }
}

const isPidAlive = (pid: number): boolean => {
  if (!Number.isFinite(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
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
        ...(input.env ? { env: input.env } : {}),
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
// Window for `zellij … attach -b` to return non-zero (bad layout, zellij
// missing). Detached creation returns 0 within tens of ms, so this only bounds
// the failure path.
const ZELLIJ_CREATE_WINDOW_MS = 3_000
// Time to let pi prove it survived startup before reading the launcher's pid /
// stderr. An unkeyed model dies in ~1s (DIS-G001), so this must comfortably
// outlast that.
const LAUNCH_WINDOW_MS = 1_500

export const PiRepoLive: Layer.Layer<PiRepo, never, PiSessionsRepo> = Layer.effect(
  PiRepo,
  Effect.gen(function* () {
    const piSessions = yield* PiSessionsRepo
    return {
      // Launch pi INSIDE a detached zellij session named `pi-<short>` so the
      // dashboard terminal can attach to a live, interactive run — the old
      // `pi -p` detached child was headless and had nothing to attach to. The
      // daemon writes a launcher script + layout to a temp dir, creates the
      // background session (`zellij -n <layout> attach -b <name>`), then reads
      // the pid pi's launcher recorded to confirm it survived startup.
      dispatch: (input) =>
        Effect.gen(function* () {
          const sessionId = crypto.randomUUID()
          const cwd = resolveSpawnCwd(input.cwd, process.env)
          const short = piShort(sessionId)
          const sessionName = piZellijSessionName(short)
          const dir = mkdtempSync(join(tmpdir(), `pid-pi-${short}-`))
          const pidPath = join(dir, "pid")
          const stderrPath = join(dir, "pi-stderr.log")
          const scriptPath = join(dir, "launch.sh")
          const layoutPath = join(dir, "layout.kdl")
          const zellijErrPath = join(dir, "zellij-stderr.log")

          const runArgv = buildPiRunArgv({
            intent: input.intent,
            sessionId,
            thinking: input.thinking,
            model: input.model,
            tools: input.tools,
          })
          writeFileSync(scriptPath, buildPiLauncherScript({ runArgv, pidPath, stderrPath }))
          writeFileSync(layoutPath, piBackgroundLayoutKdl(scriptPath))

          // Fail fast on a zellij-level problem (missing binary, unparseable
          // layout). cleanZellijEnv strips ZELLIJ_SESSION_NAME so a daemon
          // running inside a zellij pane doesn't self-attach.
          yield* spawnLaunchChecked({
            cmd: piBackgroundSessionArgv({ layoutPath, sessionName }),
            cwd,
            stderrPath: zellijErrPath,
            windowMs: ZELLIJ_CREATE_WINDOW_MS,
            env: cleanZellijEnv(process.env),
          }).pipe(
            Effect.tapError(() => Effect.sync(() => rmSync(dir, { recursive: true, force: true }))),
          )

          // The zellij CLI has returned; pi is now starting in the detached
          // pane. Give it the launch window to live or die, then read the pid
          // its launcher wrote and its captured stderr to render a verdict.
          yield* Effect.promise(() => Bun.sleep(LAUNCH_WINDOW_MS))
          const pidRaw = readFileSyncOr(pidPath, undefined)
          const pid = pidRaw ? Number.parseInt(pidRaw.trim(), 10) : Number.NaN
          const verdict = piLaunchVerdict({
            pidRaw,
            pidAlive: isPidAlive(pid),
            stderr: readFileSyncOr(stderrPath, "") ?? "",
          })
          rmSync(dir, { recursive: true, force: true })
          if (!verdict.ok) {
            return yield* Effect.fail(new ShellError({ message: verdict.message }))
          }

          // Record the run so it shows up as a session card. Liveness/state
          // refresh on each list() from pi's real pid + transcript (DIS-G004);
          // the working→done edge no longer pushes live over SSE, since pi's
          // exit happens inside the zellij pane the daemon can't observe.
          piSessions.record({
            id: sessionId,
            pid: verdict.pid,
            cwd,
            intent: input.intent,
            spawnedAt: new Date().toISOString(),
          })
          publishPiSession({ piSessions, sessionId, type: "session.created" })
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
