import fs from "node:fs"
import { Effect, Either, type ManagedRuntime } from "effect"
import { Hono } from "hono"
import { appRuntime } from "../../platform/runtime"
import { ShellIo } from "../../platform/shell.io"
import { PiSessionsIo } from "../dispatch/pi-sessions.io"
import { readFileAt, resolveRawAt, treeAt } from "../projects/fileBrowser.io"
import {
  errorToStatus,
  type FsResponse,
  runFsCreate,
  runFsDelete,
  runFsMove,
  treeGitStatusAt,
} from "../projects/fileBrowser.routes"
import { contentDispositionAttachment } from "../projects/projects.core"
import { FilesError, FilesService } from "./files.io"
import { SessionRegistry } from "./sessions.io"
import { parseWaitRequest, type WaitRequest } from "./sessions-wait.core"
import { SessionWaitIo, type WaitOutcome } from "./sessions-wait.io"

const MAX_TRANSCRIPT_LINES = 500

// Effect runtime surface the route handlers depend on. Real prod wiring passes
// `appRuntime`; route tests substitute a stub runtime built over fake
// SessionRegistry / ShellIo / FilesService layers
// (see sessions.routes.test.ts).
export type SessionsRouteRuntime = Pick<
  ManagedRuntime.ManagedRuntime<
    SessionRegistry | ShellIo | FilesService | PiSessionsIo | SessionWaitIo,
    never
  >,
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

// Resolve a session's file-browse root: its isolated worktree when present,
// else its cwd (non-isolated sessions). Returns `undefined` when the session is
// unknown and `null` when it has neither path — the routes map these to a
// not_found vs no_worktree 404 respectively.
const sessionRoot = async (
  runtime: SessionsRouteRuntime,
  id: string,
): Promise<string | null | undefined> => {
  const session = await runtime.runPromise(
    Effect.gen(function* () {
      const reg = yield* SessionRegistry
      return yield* Effect.promise(() => reg.getOne(id))
    }),
  )
  if (!session) return undefined
  return session.worktreePath ?? session.cwd ?? null
}

// The sessionId a session currently carries, or `undefined` when the session
// is unknown — read once up front so a send-with-wait can pin the wait to
// *this* occupant before any keys go out, closing the race a caller would
// otherwise hit issuing /send then /wait as two separate requests.
const currentSessionId = async (
  runtime: SessionsRouteRuntime,
  id: string,
): Promise<string | undefined> =>
  runtime.runPromise(
    Effect.gen(function* () {
      const reg = yield* SessionRegistry
      const session = yield* Effect.promise(() => reg.getOne(id))
      return session?.sessionId
    }),
  )

// Maps a WaitOutcome onto the JSON payload documented for POST /:id/wait —
// reused as-is for the `wait` field POST /:id/send embeds when the caller
// opts into submit-and-wait.
const waitOutcomeBody = ({ outcome, short }: { outcome: WaitOutcome; short: string }) => {
  switch (outcome._tag) {
    case "Satisfied":
      return { ok: true, short, state: outcome.state, waitedMs: outcome.waitedMs }
    case "Timeout":
      return { ok: false, reason: "timeout", short, waitedMs: outcome.waitedMs }
    case "OccupantChanged":
      return { ok: false, reason: "occupant_changed", short }
    case "Removed":
      return { ok: false, reason: "removed", short }
    case "NotFound":
      return { ok: false, reason: "not_found", short }
  }
}

// Shared shape for the POST /:id/fs/* session routes: resolve the worktree root
// (404 not_found / no_worktree), read the JSON body tolerantly, dispatch the
// guarded write op, and echo its mapped status.
const sessionFsRoute = async (
  // biome-ignore lint/suspicious/noExplicitAny: Hono Context generics vary per route
  c: any,
  {
    runtime,
    run,
  }: {
    runtime: SessionsRouteRuntime
    run: (root: string, body: unknown) => Promise<FsResponse>
  },
): Promise<Response> => {
  const id = c.req.param("id")
  const root = await sessionRoot(runtime, id)
  if (root === undefined) return c.json({ error: "not_found", short: id }, 404)
  if (root === null) return c.json({ error: "no_worktree", short: id }, 404)
  const body = await c.req.json().catch(() => ({}))
  const { status, body: out } = await run(root, body)
  return c.json(out, status)
}

export const buildSessionsApp = (runtime: SessionsRouteRuntime) =>
  new Hono()
    .get("/", async (c) => {
      const list = await runtime.runPromise(
        Effect.gen(function* () {
          const reg = yield* SessionRegistry
          const pi = yield* PiSessionsIo
          const claude = yield* Effect.promise(() => reg.snapshot())
          // pi runs live outside the supervisor's roster/jobs world — the
          // dispatch spawn log is their registry (see pi-sessions.io.ts).
          return [...claude, ...pi.list()]
        }),
      )
      return c.json(list)
    })
    .get("/:id", async (c) => {
      const id = c.req.param("id")
      const one = await runtime.runPromise(
        Effect.gen(function* () {
          const reg = yield* SessionRegistry
          const pi = yield* PiSessionsIo
          const claude = yield* Effect.promise(() => reg.getOne(id))
          return claude ?? pi.getOne(id)
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
          return yield* Effect.promise(() => reg.getOne(id))
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
          return yield* Effect.promise(() => reg.getOne(id))
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
    // Browse a session's worktree as a full file tree, mirroring the projects
    // file-browser routes but keyed by session short → worktreePath (falling
    // back to the session cwd for non-isolated sessions).
    .get("/:id/tree", async (c) => {
      const id = c.req.param("id")
      const root = await sessionRoot(runtime, id)
      if (root === undefined) return c.json({ error: "not_found", short: id }, 404)
      if (root === null) return c.json({ error: "no_worktree", short: id }, 404)
      const tree = await treeAt(root)
      if (!tree.ok) return c.json({ error: tree.error }, errorToStatus(tree.error))
      const withGit = c.req.query("gitStatus") === "1"
      return c.json(
        withGit ? { ...tree.value, gitStatus: await treeGitStatusAt(root) } : tree.value,
      )
    })
    .get("/:id/file", async (c) => {
      const id = c.req.param("id")
      const path = c.req.query("path") ?? ""
      if (!path) return c.json({ error: "missing_path" }, 400)
      const root = await sessionRoot(runtime, id)
      if (root === undefined) return c.json({ error: "not_found", short: id }, 404)
      if (root === null) return c.json({ error: "no_worktree", short: id }, 404)
      const result = await readFileAt(root, path)
      if (!result.ok) return c.json({ error: result.error }, errorToStatus(result.error))
      return c.json(result.value)
    })
    .get("/:id/raw", async (c) => {
      const id = c.req.param("id")
      const path = c.req.query("path") ?? ""
      if (!path) return c.json({ error: "missing_path" }, 400)
      const root = await sessionRoot(runtime, id)
      if (root === undefined) return c.json({ error: "not_found", short: id }, 404)
      if (root === null) return c.json({ error: "no_worktree", short: id }, 404)
      const result = await resolveRawAt(root, path)
      if (!result.ok) return c.json({ error: result.error }, errorToStatus(result.error))
      const { absPath, size, mime } = result.value
      const headers: Record<string, string> = {
        "Content-Type": mime,
        "Content-Length": String(size),
        "Cache-Control": "private, max-age=30",
        "X-Content-Type-Options": "nosniff",
      }
      if (c.req.query("download") === "1") {
        headers["Content-Disposition"] = contentDispositionAttachment(path)
      }
      return new Response(Bun.file(absPath).stream(), { status: 200, headers })
    })
    // Filesystem mutations for the session worktree, mirroring the projects
    // /fs/* routes. Resolve the session root (not_found / no_worktree 404s) then
    // dispatch the same guarded write ops.
    .post("/:id/fs/create", (c) => sessionFsRoute(c, { runtime, run: runFsCreate }))
    .post("/:id/fs/move", (c) => sessionFsRoute(c, { runtime, run: runFsMove }))
    .post("/:id/fs/delete", (c) => sessionFsRoute(c, { runtime, run: runFsDelete }))
    .post("/:id/stop", async (c) => {
      const id = c.req.param("id")
      const result = await runtime.runPromiseExit(
        Effect.gen(function* () {
          const shell = yield* ShellIo
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
          const shell = yield* ShellIo
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
          // A pi session has no claude job dir — removing it just drops the
          // spawn-log entry (the pi transcript stays on disk, resumable).
          const pi = yield* PiSessionsIo
          if (pi.remove(id)) return
          const shell = yield* ShellIo
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
      const body = (await c.req.json().catch(() => ({}))) as { keys?: unknown; wait?: unknown }
      if (typeof body.keys !== "string" || body.keys.length === 0) {
        return c.json({ error: "bad_keys", message: "keys must be a non-empty string" }, 400)
      }
      if (body.keys.length > 4096) {
        return c.json({ error: "keys_too_long", message: "keys length capped at 4096" }, 413)
      }
      // A malformed `wait` object is rejected before anything is sent — the
      // caller gets a clean 400 rather than keys going out with no wait.
      let waitRequest: WaitRequest | undefined
      if (body.wait !== undefined) {
        const parsedWait = parseWaitRequest(body.wait)
        if (Either.isLeft(parsedWait)) {
          return c.json({ error: "bad_request", message: parsedWait.left.message }, 400)
        }
        waitRequest = parsedWait.right
      }
      // Capture the occupant's sessionId *before* sending, so the wait below
      // is pinned to whoever held the session at request time — not whoever
      // (if anyone) replaces it by the time the wait actually starts.
      const pinnedSessionId = waitRequest ? await currentSessionId(runtime, id) : undefined
      const result = await runtime.runPromiseExit(
        Effect.gen(function* () {
          const shell = yield* ShellIo
          yield* shell.send({ id, keys: body.keys as string })
        }),
      )
      if (result._tag === "Failure") {
        return c.json({ error: "send_failed", short: id }, 500)
      }
      if (!waitRequest) return c.json({ ok: true, short: id })
      const outcome = await runtime.runPromise(
        Effect.flatMap(SessionWaitIo, (svc) =>
          svc.wait({ short: id, request: waitRequest, pinnedSessionId }),
        ),
      )
      return c.json({ ok: true, short: id, wait: waitOutcomeBody({ outcome, short: id }) })
    })
    .post("/:id/wait", async (c) => {
      const id = c.req.param("id")
      const rawBody = await c.req.json().catch(() => ({}))
      const parsed = parseWaitRequest(rawBody)
      if (Either.isLeft(parsed)) {
        return c.json({ error: "bad_request", message: parsed.left.message }, 400)
      }
      const outcome = await runtime.runPromise(
        Effect.flatMap(SessionWaitIo, (svc) => svc.wait({ short: id, request: parsed.right })),
      )
      if (outcome._tag === "NotFound") return c.json({ error: "not_found", short: id }, 404)
      return c.json(waitOutcomeBody({ outcome, short: id }))
    })

const app = buildSessionsApp(appRuntime)

export { app }
