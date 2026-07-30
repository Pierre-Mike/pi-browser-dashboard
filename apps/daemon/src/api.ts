import { join, normalize } from "node:path"
import { Cause, Effect, Either, Option } from "effect"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { resolveCorsOrigin } from "./cors.core"
import * as brainstormsRoute from "./features/brainstorms/brainstorms.routes"
import * as claudeConfigRoute from "./features/claude-config/claude-config.routes"
import * as dispatchRoute from "./features/dispatch/dispatch.routes"
import * as eventsRoute from "./features/events/events.routes"
import * as extensionsRoute from "./features/extensions/extensions.routes"
import * as fleetRoute from "./features/fleet/fleet.routes"
import type { FleetRunPorts } from "./features/fleet/fleet-run.io"
import { fleetRunRegistry } from "./features/fleet/fleet-run.io"
import * as globalSettingsRoute from "./features/global-settings/global-settings.routes"
import * as issueDriverRoute from "./features/issue-driver/issue-driver.routes"
import * as libraryRoute from "./features/library/library.routes"
import * as fileBrowserWriteRoute from "./features/projects/fileBrowserWrite.routes"
import * as projectsRoute from "./features/projects/projects.routes"
import { createRulesEngine, type RulesPorts } from "./features/rules/rules.io"
import * as rulesRoute from "./features/rules/rules.routes"
import * as sessionsRoute from "./features/sessions/sessions.routes"
import { parseKeysRequest } from "./features/sessions/sessions-keys.core"
import { SessionWaitIo } from "./features/sessions/sessions-wait.io"
import { buildStaticApp } from "./features/static-web/static-web.routes"
import * as terminalRoute from "./features/terminal/terminal.routes"
import * as tunnelRoute from "./features/tunnel/tunnel.routes"
import * as uploadsRoute from "./features/uploads/uploads.routes"
import { AGENT_SKILL_MD } from "./platform/agent-skill"
import { extensionRegistry } from "./platform/extensions/registry"
import { appRuntime } from "./platform/runtime"
import { validateRelPath } from "./platform/safe-path.core"
import { ShellIo } from "./platform/shell.io"
import { sseBus } from "./platform/sse-bus"

// Shared by fleetRunPorts/rulesPorts below: runs an Effect against the real
// ShellIo through runPromiseExit rather than runPromise, so a ShellError's
// own message (not an Effect FiberFailure dump) becomes the port's own
// rejection — the same reason dispatchRoute.buildDispatchApp does this.
const runShellEffectOrThrow = async <A>({
  effect,
  fallbackMessage,
}: {
  readonly effect: Effect.Effect<A, { readonly message: string }, ShellIo>
  readonly fallbackMessage: string
}): Promise<A> => {
  const exit = await appRuntime.runPromiseExit(effect)
  if (exit._tag === "Failure") {
    const detail = Option.map(Cause.failureOption(exit.cause), (e) => e.message)
    throw new Error(Option.getOrElse(detail, () => fallbackMessage))
  }
  return exit.value
}

// Bridges the fleet run engine's plain-Promise ports (features/fleet/ must not
// import the sessions slice or platform/shell.io directly — see
// fleet-run.io.ts's own header) to the real ShellIo/SessionWaitIo Effect
// services.
const fleetRunPorts: FleetRunPorts = {
  now: () => Date.now(),
  newRunId: () => crypto.randomUUID(),
  spawn: ({ intent, agent, cwd }) =>
    runShellEffectOrThrow({
      effect: Effect.gen(function* () {
        const shell = yield* ShellIo
        return yield* shell.dispatch({ intent, agent, cwd })
      }),
      fallbackMessage: "dispatch failed",
    }),
  // `via: "supervisor"` keeps a fleet step's wait meaning exactly what it
  // meant before the screen became a wait source: a fleet recipe has no `via`
  // field yet, and inferring one from the pane would change every existing
  // recipe's semantics silently.
  wait: async ({ short, until, timeoutMs }) => {
    const outcome = await appRuntime.runPromise(
      Effect.gen(function* () {
        const sessionWait = yield* SessionWaitIo
        return yield* sessionWait.wait({
          short,
          // A fleet recipe has no pattern field, so `untilOutput` is always
          // undefined here and the screens port is never consulted — passed
          // anyway so a future step-level pattern needs no wiring change.
          request: { until, untilOutput: undefined, timeoutMs, via: "supervisor" },
          readTerminalState: terminalRoute.readTerminalState,
          terminalScreens,
        })
      }),
    )
    // Adapting one slice's vocabulary to another's port is this composition
    // root's job, so the two screen-pattern outcomes are narrowed away here
    // rather than widening the fleet engine's own WaitOutcomeLike for cases its
    // recipes cannot express. Unreachable given `untilOutput: undefined` above;
    // `Timeout` is the closest existing meaning if it ever were reached — the
    // step did not get to the state it asked for.
    if (outcome._tag === "OutputMatched") {
      return { _tag: "Timeout", waitedMs: outcome.waitedMs }
    }
    if (outcome._tag === "ScreenPollingDisabled") {
      return { _tag: "Timeout", waitedMs: 0 }
    }
    return outcome
  },
}

// Bridges the rules engine's plain-Promise ports (features/rules/ must not
// import the sessions slice or platform/shell.io directly — see
// rules.io.ts's own header) to the real ShellIo/sse-bus. `notify` publishes a
// standalone `notification` event (not `rules.fired`, which the engine
// itself already publishes for every outcome as its own audit trail) so a
// future web toast/notifier has one simple, human-facing event to listen
// for. `sendKeys` re-resolves the named sequence through the same
// `parseKeysRequest` the HTTP endpoint uses rather than encoding bytes here, so
// a rule's keystrokes and a caller's take one code path. Both ends now validate
// against the one `NAMED_KEYS` declaration in `@pid/shared`, so this is no
// longer guarding against a drifted copy — it is reusing the resolver.
const rulesPorts: RulesPorts = {
  now: () => Date.now(),
  notify: async ({ short, rule, message }) => {
    sseBus.publish({ type: "notification", data: { short, rule, message, at: Date.now() } })
  },
  sendKeys: async ({ short, sequence }) => {
    const parsed = parseKeysRequest({ sequence: sequence.map((named) => ({ named })) })
    if (Either.isLeft(parsed)) {
      throw new Error(`rules: unresolvable key sequence for ${short}: ${parsed.left.message}`)
    }
    await runShellEffectOrThrow({
      effect: Effect.gen(function* () {
        const shell = yield* ShellIo
        yield* shell.send({ id: short, keys: parsed.right.keys })
      }),
      fallbackMessage: "rules: send failed",
    })
  },
  stop: ({ short }) =>
    runShellEffectOrThrow({
      effect: Effect.gen(function* () {
        const shell = yield* ShellIo
        yield* shell.stop(short)
      }),
      fallbackMessage: "rules: stop failed",
    }),
}

// Constructing the engine only wires its (inert) internal state — it does
// NOT subscribe to the SSE bus. Importing this module must never itself
// start acting on the user's live sessions; only server.ts's startDaemon()
// calls `rulesEngine.start()`. See rules.io.ts's own header for why.
export const rulesEngine = createRulesEngine({ ports: rulesPorts })

// Same construct-then-start split, same reason: the unattended terminal-state
// poller spawns `zellij` against the user's live sessions, so importing this
// module must not arm it. Only server.ts's startDaemon() calls start().
export const terminalPoller = terminalRoute.terminalPoller

// The terminal slice's screen-text channel, as one port. Screen text is
// deliberately absent from `sseBus` (that stream reaches every browser — see
// terminal.routes.ts's subscribeTerminalScreens), so a `wait --until-output`
// subscribes through here. `enabled` is the poller's own armed state: an output
// wait resolves off its passes and nothing else, so with polling disabled the
// request is refused up front instead of timing out.
const terminalScreens = {
  enabled: () => terminalRoute.terminalPoller.isEnabled(),
  subscribe: terminalRoute.subscribeTerminalScreens,
  // The same refresh-on-read hook GET /terminal/states uses, for the same
  // reason: a wait that is about to judge how fresh a stored reading is should
  // first give the poller the chance to take a pass it has fallen behind on.
  // Bounded by the poller itself — inert when disabled or recently passed, and
  // overlapping calls share one in-flight pass — so this cannot turn a burst of
  // waits into a burst of `zellij` spawns.
  refreshIfStale: () => terminalRoute.terminalPoller.refreshIfStale(),
}

// Minimal content-type map for extension static assets (iframe tier).
const EXT_MIME_BY_EXT: Record<string, string> = {
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  woff: "font/woff",
  woff2: "font/woff2",
  map: "application/json; charset=utf-8",
}

const extMime = (rel: string): string => {
  const dot = rel.toLowerCase().lastIndexOf(".")
  if (dot === -1) return "application/octet-stream"
  return EXT_MIME_BY_EXT[rel.toLowerCase().slice(dot + 1)] ?? "application/octet-stream"
}
const app = new Hono()
  .use(
    "*",
    cors({
      // Evaluated per-request so a caller can inject PID_CORS_ORIGINS before
      // serving even though this module is imported earlier. See cors.core.ts.
      // The pure core gets exactly the key it reads, named at the call site,
      // rather than the whole ambient environment.
      origin: (origin) =>
        resolveCorsOrigin({
          requestOrigin: origin,
          env: { PID_CORS_ORIGINS: process.env.PID_CORS_ORIGINS },
        }),
      allowHeaders: ["Content-Type", "Last-Event-ID"],
      allowMethods: ["GET", "POST", "OPTIONS"],
      credentials: false,
    }),
  )
  .get("/health", (c) => c.json({ ok: true }))
  // Served on the plain app (not a mounted sub-router) so it is reachable both
  // bare and under /__api — see buildApp below. Teaches an agent this
  // daemon's own control surface (pid CLI + HTTP); guarded against drifting
  // from the real vocabulary/constants/routes by platform/agent-skill.test.ts.
  .get("/agent-skill.md", (c) =>
    c.text(AGENT_SKILL_MD, 200, { "Content-Type": "text/markdown; charset=utf-8" }),
  )
  // The sessions router is built here, not in its own module, because it needs
  // a port only a composition root can hand it: `readTerminalState`, the
  // terminal slice's published door onto the polled screen classifications.
  // That is what lets a wait resolve on what the pane actually shows
  // (`via: "screen"`/`"either"`) and lets `GET /sessions/:id/explain` cite the
  // screen — without the sessions slice importing the terminal slice.
  .route(
    "/sessions",
    sessionsRoute.buildSessionsApp({
      runtime: appRuntime,
      readTerminalState: terminalRoute.readTerminalState,
      terminalScreens,
    }),
  )
  // Brainstorm boards are the canvas files in the session's own worktree, so
  // they hang off the session — an agent editing one writes inside the tree it
  // already owns. Mounted here rather than inside the sessions router so the
  // brainstorms slice stays independent of it: the root resolver is passed in.
  .route("/sessions", brainstormsRoute.createApp(sessionsRoute.resolveSessionRoot))
  .route("/projects", projectsRoute.app)
  .route("/projects", fileBrowserWriteRoute.app)
  // Fleet recipes (declarative multi-agent runs in <project>/.pid/fleet.json):
  // GET /projects/:id/fleets (schema + validation + wave planning), POST
  // /projects/:id/fleets/:name/run (dry-run or real execution), GET
  // /projects/:id/fleet-runs[/:runId] (run status). Mounted here (not inside
  // projects.routes.ts) so the fleet slice never imports the projects slice:
  // the root resolver is passed in, the same pattern brainstormsRoute uses
  // for sessionsRoute above. `registry` and `ports` are this composition
  // root's bridge from the fleet slice's plain-Promise ports to the real
  // ShellIo/SessionWaitIo Effect services (see fleetRunPorts above).
  .route(
    "/projects",
    fleetRoute.createApp({
      resolveRoot: projectsRoute.resolveProjectRoot,
      registry: fleetRunRegistry,
      ports: fleetRunPorts,
    }),
  )
  .route("/dispatch", dispatchRoute.app)
  .route("/events", eventsRoute.app)
  .route("/terminal", terminalRoute.app)
  .route("/tunnel", tunnelRoute.app)
  .route("/issue-driver", issueDriverRoute.app)
  // State-change rules (<claudeConfigDir>/pid-dashboard/rules.json): GET
  // /rules (parsed rules + validation errors + enabled/paused + firing log),
  // POST /rules/pause, POST /rules/preview (dry-run — fires nothing). Off by
  // default; see rules.io.ts / AGENTS.md "State-change rules".
  .route("/rules", rulesRoute.createApp({ engine: rulesEngine }))
  .route("/claude-config", claudeConfigRoute.app)
  .route("/library", libraryRoute.app)
  .route("/uploads", uploadsRoute.app)
  .route("/", globalSettingsRoute.app)
  .get("/extensions", (c) =>
    c.json(extensionRegistry.list().map((e) => extensionsRoute.extensionListEntry(e))),
  )
  // Enable/disable/grants management endpoints (POST /extensions/:name/...).
  .route("/extensions", extensionsRoute.app)
  .get("/extensions/:name/*", async (c) => {
    const name = c.req.param("name")
    const ext = extensionRegistry.get(name)
    if (!ext) return c.json({ error: "not_found" }, 404)
    // Everything after /extensions/<name>/ is the requested asset path.
    const prefix = `/extensions/${name}/`
    const idx = c.req.path.indexOf(prefix)
    const rawRel = idx === -1 ? "" : c.req.path.slice(idx + prefix.length)
    let rel: string
    try {
      rel = decodeURIComponent(rawRel)
    } catch {
      return c.json({ error: "bad_path" }, 400)
    }
    // Reject traversal / absolute escapes before touching the filesystem.
    if (!rel || !validateRelPath(rel)) {
      return c.json({ error: "bad_path" }, 400)
    }
    const baseDir = normalize(ext.dir)
    const abs = normalize(join(baseDir, rel))
    if (abs !== baseDir && !abs.startsWith(`${baseDir}/`)) {
      return c.json({ error: "bad_path" }, 400)
    }
    const file = Bun.file(abs)
    if (!(await file.exists())) return c.json({ error: "not_found" }, 404)
    return new Response(file.stream(), {
      status: 200,
      headers: {
        "Content-Type": extMime(rel),
        "Cache-Control": "private, max-age=30",
        "X-Content-Type-Options": "nosniff",
      },
    })
  })

// Mount every extension's Hono app under /ext/<name>. Call this AFTER
// loadExtensions() has populated the registry — at module load the registry is
// empty, so calling it here would mount nothing.
export const mountExtensions = (appInstance: Hono): void => {
  for (const m of extensionRegistry.mounts()) {
    appInstance.route(m.basePath, m.app)
  }
}

export type AppType = typeof app

// Compose the final request handler. With no staticDir this preserves today's
// shape exactly — the API mounted directly at "/" (dev daemon, e2e). Passing
// staticDir switches to a same-origin layout for the
// pid-dashboard CLI's single-port distribution: the SPA owns "/" (with
// history-API fallback for client routes like "/sessions/:id" that would
// otherwise collide with the identically-named API routes below), and the API
// moves behind "/__api" — the same prefix contract apps/web/src/lib/apiBase.ts
// already falls back to for same-origin callers, previously only exercised by
// the Cloudflare-tunnel dev proxy. SSE stays unprefixed everywhere (sse.ts
// always hits "/events" directly), so it's aliased at the bare path too.
// Call AFTER mountExtensions(app) so extension routes are captured below.
// The prefix the API moves to when the SPA owns "/". Exported because a
// spawned session has to be told where /agent-skill.md really answers
// (server.ts's armAgentDiscovery), and a second literal would be free to drift.
export const API_PREFIX = "/__api"

export const buildApp = (staticDir?: string): Hono => {
  const wrapper = new Hono().route(API_PREFIX, app)
  if (!staticDir) return wrapper.route("/", app)
  return wrapper.route("/events", eventsRoute.app).route("/", buildStaticApp(staticDir))
}

export { websocket } from "./platform/ws"
export { app }
export default app
