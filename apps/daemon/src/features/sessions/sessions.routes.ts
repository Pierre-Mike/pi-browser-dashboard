import fs from "node:fs"
import { Effect, type ManagedRuntime } from "effect"
import { Hono } from "hono"
import { appRuntime } from "../../platform/runtime"
import { ShellRepo } from "../../platform/shell.repo"
import { FilesError, FilesService } from "./files.repo"
import { SessionRegistry } from "./sessions.repo"

const MAX_TRANSCRIPT_LINES = 500

// Effect runtime surface the route handlers depend on. Real prod wiring passes
// `appRuntime`; route tests substitute a stub runtime built over fake
// SessionRegistry / ShellRepo / FilesService layers
// (see sessions.routes.test.ts).
export type SessionsRouteRuntime = Pick<
  ManagedRuntime.ManagedRuntime<SessionRegistry | ShellRepo | FilesService, never>,
  "runPromise" | "runPromiseExit"
>

const readTranscript = async (
  filePath: string,
): Promise<{ messages: unknown[]; truncated: boolean }> => {
  const file = await fs.promises.readFile(filePath, "utf8")
  const allLines = file.split(/\r?\n/).filter((line) => line.trim().length > 0)
  const truncated = allLines.length > MAX_TRANSCRIPT_LINES
  const slice = truncated ? allLines.slice(-MAX_TRANSCRIPT_LINES) : allLines
  const messages: unknown[] = []
  for (const line of slice) {
    try {
      messages.push(JSON.parse(line) as unknown)
    } catch {
      messages.push({ _parseError: true, raw: line })
    }
  }
  return { messages, truncated }
}

export const buildSessionsApp = (runtime: SessionsRouteRuntime) =>
  new Hono()
    .get("/", async (c) => {
      const list = await runtime.runPromise(
        Effect.gen(function* () {
          const reg = yield* SessionRegistry
          return reg.snapshot()
        }),
      )
      return c.json(list)
    })
    .get("/:id", async (c) => {
      const id = c.req.param("id")
      const one = await runtime.runPromise(
        Effect.gen(function* () {
          const reg = yield* SessionRegistry
          return reg.getOne(id)
        }),
      )
      if (!one) return c.json({ error: "not_found", short: id }, 404)
      return c.json(one)
    })
    .get("/:id/transcript", async (c) => {
      const id = c.req.param("id")
      const one = await runtime.runPromise(
        Effect.gen(function* () {
          const reg = yield* SessionRegistry
          return reg.getOne(id)
        }),
      )
      if (!one) return c.json({ error: "not_found", short: id }, 404)
      if (!one.linkScanPath) return c.json({ error: "no_transcript", short: id }, 404)
      try {
        const { messages, truncated } = await readTranscript(one.linkScanPath)
        return c.json({ messages, truncated, path: one.linkScanPath })
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException | undefined)?.code
        const status = code === "ENOENT" ? 404 : 500
        return c.json({ error: "transcript_read_failed", code }, status)
      }
    })
    .get("/:id/files", async (c) => {
      const id = c.req.param("id")
      const session = await runtime.runPromise(
        Effect.gen(function* () {
          const reg = yield* SessionRegistry
          return reg.getOne(id)
        }),
      )
      if (!session) return c.json({ error: "not_found", short: id }, 404)
      if (!session.worktreePath) {
        // Non-isolated session — no per-session diff to compute.
        return c.json({
          short: id,
          changed: false,
          files: [],
          diff: "",
          truncated: false,
          base: null,
          worktreePath: null,
        })
      }
      const result = await runtime.runPromiseExit(
        Effect.gen(function* () {
          const svc = yield* FilesService
          return yield* svc.diffWorktree(session.worktreePath ?? "")
        }),
      )
      if (result._tag === "Failure") {
        const failure = result.cause
        // Best-effort: surface our FilesError reason as the HTTP error.
        let reason: string | undefined
        const squashed = await runtime.runPromise(
          Effect.either(Effect.failCause(failure)).pipe(
            Effect.map((e) => (e._tag === "Left" ? e.left : null)),
          ),
        )
        if (squashed instanceof FilesError) reason = squashed.reason
        return c.json({ error: "diff_failed", short: id, reason }, 500)
      }
      return c.json({ short: id, ...result.value })
    })
    .post("/:id/stop", async (c) => {
      const id = c.req.param("id")
      const result = await runtime.runPromiseExit(
        Effect.gen(function* () {
          const shell = yield* ShellRepo
          yield* shell.stop(id)
        }),
      )
      if (result._tag === "Failure") {
        return c.json({ error: "stop_failed", short: id }, 500)
      }
      return c.json({ ok: true, short: id })
    })
    .post("/:id/peek", async (c) => {
      const id = c.req.param("id")
      const result = await runtime.runPromiseExit(
        Effect.gen(function* () {
          const shell = yield* ShellRepo
          return yield* shell.peek(id)
        }),
      )
      if (result._tag === "Failure") {
        return c.json({ error: "peek_failed", short: id }, 500)
      }
      return c.json({ short: id, summary: result.value })
    })
    .post("/:id/rm", async (c) => {
      const id = c.req.param("id")
      const result = await runtime.runPromiseExit(
        Effect.gen(function* () {
          const shell = yield* ShellRepo
          yield* shell.rm(id)
        }),
      )
      if (result._tag === "Failure") {
        return c.json({ error: "rm_failed", short: id }, 500)
      }
      return c.json({ ok: true, short: id })
    })
    .post("/:id/send", async (c) => {
      const id = c.req.param("id")
      const body = (await c.req.json().catch(() => ({}))) as { keys?: unknown }
      if (typeof body.keys !== "string" || body.keys.length === 0) {
        return c.json({ error: "bad_keys", message: "keys must be a non-empty string" }, 400)
      }
      if (body.keys.length > 4096) {
        return c.json({ error: "keys_too_long", message: "keys length capped at 4096" }, 413)
      }
      const result = await runtime.runPromiseExit(
        Effect.gen(function* () {
          const shell = yield* ShellRepo
          yield* shell.send({ id, keys: body.keys as string })
        }),
      )
      if (result._tag === "Failure") {
        return c.json({ error: "send_failed", short: id }, 500)
      }
      return c.json({ ok: true, short: id })
    })

const app = buildSessionsApp(appRuntime)

export { app }
