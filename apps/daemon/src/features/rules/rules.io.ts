// Imperative engine for state-change automation rules: reads
// <claudeConfigDir>/pid-dashboard/rules.json, subscribes to the SSE bus for
// `session.state` / `session.removed` transitions, runs a periodic dwell
// sweep, and fires actions through injected ports.
//
// Like fleet-run.io.ts, this is a plain factory closing over private state
// rather than an Effect service: the rules slice must not import the
// sessions slice or platform/shell.io directly (axiom-debt's
// cross-slice-import counter fails the build on any NEW violation), so every
// effectful capability the engine needs to actually DO something
// (notify/sendKeys/stop) is a plain async function type — api.ts (outside
// any slice, so free of the ratchet) wires the real ShellIo/sse-bus/whatever
// implementations into it. Reading rules.json is a plain fs read scoped to
// `configDir`, the same non-service shape fleet.io.ts's `readFleetFile`
// uses for its own recipe file.
//
// Where the engine gets its picture of "what is every session doing right
// now" without a fifth port: it never queries the sessions slice at all. It
// subscribes to the SAME `session.state` / `session.removed` events the web
// UI's own SSE listener does, decodes them with rules.core's own (mirrored)
// decoders, and keeps a private per-short view (state, harness, when the
// current state was entered).
//
// It subscribes to `terminal.state` on that same bus for the screen reading, and
// this is why no cross-slice import is needed for it either: `terminal.routes.ts`
// already publishes every classification there through its single writer
// `publishTerminalState`, so the engine decodes a bus payload defensively
// (`decodeTerminalStatePayload`) exactly as it does a session one. Screen views
// live in their own map keyed by the same short — see ScreenView's comment for
// why they are not folded into SessionView.
//
// server.ts wires this subscription up BEFORE
// touching SessionRegistry, so the boot-time replay of every known session's
// state (the registry's jobs-dir scan + roster reconciliation, both of which
// publish on the bus) still lands here. This daemon has previously lost its
// entire timer subsystem on a long uptime (see sessions.io.ts's own
// `ensureFresh` comment — the registry's refresh-on-read exists because of
// it); a periodic `tick()` here is the same kind of belt-and-suspenders, but
// a dwell rule still ultimately depends on this engine's own subscription
// having stayed alive, so it must not be the only thing a user relies on.
//
// The bus subscription is armed by an explicit `start()`, not at
// `createRulesEngine` construction time: `api.ts` builds the module-level
// engine (with the REAL notify/sendKeys/stop ports) purely by importing this
// module, and importing a module must never itself start acting on a user's
// live sessions — including from a test that merely imports `api.ts` for an
// unrelated route. Only `server.ts`'s `startDaemon()` (the composition root
// that actually boots the daemon process) calls `start()`.
//
// Firing history lives in memory only (this daemon persists nothing) and is
// bounded — see HISTORY_LIMIT / LOG_LIMIT below. So is every dwell anchor: a
// daemon restart loses `stateEnteredAt` for both readings, and each view is
// re-seeded with `stateEnteredAt = now` by the first event after boot (the
// registry's own state replay for the supervisor side, the first poller pass —
// within one poll interval — for the screen side). A dwell rule therefore starts
// counting from zero at boot: a pane that had been blocked for an hour needs its
// full `forMs` again. That is deliberate and it fails in the safe direction. The
// alternative, persisting anchors, would have a restart immediately fire every
// dwell rule whose window had already elapsed while the firing history that
// enforces the cooldown and the per-session ceiling — also in memory — came back
// empty, i.e. a burst of actions with both loop breakers reset.

import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { resolveConfigDir } from "../../platform/config-dir"
import { sseBus } from "../../platform/sse-bus"
import {
  ageMs,
  applyScreenEvent,
  applyStateEvent,
  computeStale,
  decodeSessionRemovedPayload,
  decodeSessionStatePayload,
  decodeTerminalStatePayload,
  evaluate,
  evaluateScreen,
  type FiringRecord,
  parseRulesFile,
  type RuleError,
  type RuleOutcome,
  type RulesFile,
  type ScreenView,
  type SessionSnapshot,
  type SessionView,
} from "./rules.core"

// The rules file lives under the resolved Claude config dir, in the same
// dashboard-owned subdir as global-settings.io.ts's GLOBAL_SETTINGS_REL_PATH
// so it never collides with Claude's own files.
export const RULES_REL_PATH = "pid-dashboard/rules.json"

export type RulesPorts = {
  readonly notify: (input: {
    readonly short: string
    readonly rule: string
    readonly message: string
  }) => Promise<void>
  readonly sendKeys: (input: {
    readonly short: string
    readonly sequence: readonly string[]
  }) => Promise<void>
  readonly stop: (input: { readonly short: string }) => Promise<void>
  readonly now: () => number
}

const tryReadText = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, "utf8")
  } catch {
    return null
  }
}

export type RulesReadResult = {
  readonly rulesFile: RulesFile
  readonly errors: ReadonlyArray<RuleError>
}

const EMPTY_RULES_FILE: RulesFile = { enabled: false, rules: [] }

// Absent file is not an error — mirrors fleet.io.ts's readFleetFile: a
// dashboard with no rules.json yet simply has automation off. Malformed JSON
// degrades to a single file-level RuleError rather than throwing.
export const readRulesFile = async (configDir: string): Promise<RulesReadResult> => {
  const text = await tryReadText(join(configDir, RULES_REL_PATH))
  if (text === null || text.trim() === "") return { rulesFile: EMPTY_RULES_FILE, errors: [] }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return {
      rulesFile: EMPTY_RULES_FILE,
      errors: [{ rule: "(file)", message: "rules.json is not valid JSON" }],
    }
  }
  const parsed = parseRulesFile(raw)
  return parsed._tag === "Right"
    ? { rulesFile: parsed.right, errors: [] }
    : { rulesFile: EMPTY_RULES_FILE, errors: parsed.left }
}

// --- Firing log / history ----------------------------------------------------

// Every outcome `evaluate` ever produced (fired AND suppressed) — what GET
// /rules and `pid rules` render. Bounded so a busy rules file cannot grow
// this without limit over a long daemon uptime.
export type FiringLogEntry = RuleOutcome & { readonly at: number }

const HISTORY_LIMIT = 500
const LOG_LIMIT = 200

export type RulesStatus = {
  readonly enabled: boolean
  readonly paused: boolean
  readonly errors: ReadonlyArray<RuleError>
  readonly rules: RulesFile["rules"]
  readonly log: ReadonlyArray<FiringLogEntry>
}

export type PreviewResult = {
  readonly errors: ReadonlyArray<RuleError>
  readonly outcomes: ReadonlyArray<RuleOutcome>
}

export type RulesEngineApi = {
  // Arms the SSE-bus subscription. Idempotent (a second call is a no-op) —
  // see this file's header for why construction and starting are split.
  readonly start: () => void
  readonly status: () => Promise<RulesStatus>
  readonly pause: (paused: boolean) => Promise<void>
  // Evaluates every currently-known session against the rules file on disk
  // right now and reports what would happen — fires nothing, touches no
  // port, records nothing. Ignores the file's own top-level `enabled` gate
  // (but not a rule's own `enabled`) so an author can test-drive a rules
  // file before ever flipping automation on.
  readonly preview: () => Promise<PreviewResult>
  readonly tick: () => Promise<void>
}

const snapshotOf = ({
  view,
  now,
}: {
  readonly view: SessionView
  readonly now: number
}): SessionSnapshot => ({
  short: view.short,
  state: view.state,
  harness: view.harness,
  stale: computeStale({
    state: view.state,
    updatedAtAgeMs: ageMs({ now, atMs: view.updatedAtMs }),
  }),
})

// `Date.parse` lives here, not in rules.core.ts — *.core.ts bans the `Date`
// global outright (see CLAUDE.md's impureim-sandwich section).
const parseUpdatedAtMs = (updatedAt: string | undefined): number | undefined => {
  if (updatedAt === undefined) return undefined
  const ms = Date.parse(updatedAt)
  return Number.isNaN(ms) ? undefined : ms
}

export const createRulesEngine = ({
  ports,
  configDir = resolveConfigDir(),
}: {
  readonly ports: RulesPorts
  readonly configDir?: string
}): RulesEngineApi => {
  const sessions = new Map<string, SessionView>()
  const screens = new Map<string, ScreenView>()
  const history: FiringRecord[] = []
  const log: FiringLogEntry[] = []
  let paused = false

  const recordLog = (entry: RuleOutcome, at: number): void => {
    log.push({ ...entry, at })
    if (log.length > LOG_LIMIT) log.splice(0, log.length - LOG_LIMIT)
  }

  const recordFired = ({ rule, short, at }: FiringRecord): void => {
    history.push({ rule, short, at })
    if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT)
  }

  // Never throws: a port rejecting (the session vanished mid-action, a shell
  // error) is logged, not fatal — one rule's misfire must not take the
  // engine's subscription down with it.
  const runAction = async (
    outcome: Extract<RuleOutcome, { readonly _tag: "Fired" }>,
  ): Promise<void> => {
    try {
      if (outcome.action.action === "notify") {
        await ports.notify({
          short: outcome.short,
          rule: outcome.rule,
          message: outcome.action.message,
        })
      } else if (outcome.action.action === "keys") {
        await ports.sendKeys({ short: outcome.short, sequence: outcome.action.sequence })
      } else {
        await ports.stop({ short: outcome.short })
      }
    } catch (err) {
      console.error(`[rules] action failed for rule "${outcome.rule}" on ${outcome.short}`, err)
    }
  }

  // Records and publishes every outcome (fired AND suppressed — a
  // silently-throttled automation is indistinguishable from a broken one),
  // then actually runs the ones that fired.
  const applyOutcomes = async ({
    outcomes,
    now,
  }: {
    readonly outcomes: ReadonlyArray<RuleOutcome>
    readonly now: number
  }): Promise<void> => {
    for (const outcome of outcomes) {
      recordLog(outcome, now)
      sseBus.publish({ type: "rules.fired", data: { ...outcome, at: now } })
      if (outcome._tag === "Fired") {
        recordFired({ rule: outcome.rule, short: outcome.short, at: now })
        await runAction(outcome)
      }
    }
  }

  // The one place the rules file is re-read and its top-level gate is checked
  // before anything can fire. `compute` is handed the freshly-parsed file so the
  // caller decides WHICH reading it is evaluating without duplicating the gate —
  // a screen path that forgot the `enabled` check would be the worst possible
  // bug in this slice.
  const applyLiveFile = async ({
    compute,
    now,
  }: {
    readonly compute: (rulesFile: RulesFile) => ReadonlyArray<RuleOutcome>
    readonly now: number
  }): Promise<void> => {
    const { rulesFile, errors } = await readRulesFile(configDir)
    if (errors.length > 0 || !rulesFile.enabled) return
    await applyOutcomes({ outcomes: compute(rulesFile), now })
  }

  const onSessionState = async (payload: unknown): Promise<void> => {
    const decoded = decodeSessionStatePayload(payload)
    if (decoded === undefined) return
    const now = ports.now()
    const existing = sessions.get(decoded.short)
    const applied = applyStateEvent({
      existing,
      short: decoded.short,
      state: decoded.state,
      harness: decoded.harness,
      updatedAtMs: parseUpdatedAtMs(decoded.updatedAt),
      now,
    })
    sessions.set(decoded.short, applied.view)
    if (!applied.transitioned || paused) return
    await applyLiveFile({
      now,
      compute: (rulesFile) =>
        evaluate({
          rules: rulesFile,
          session: snapshotOf({ view: applied.view, now }),
          prior: applied.prior,
          dwellMs: 0,
          now,
          history,
        }),
    })
  }

  // The screen mirror of onSessionState. The poller already publishes only on a
  // state change, so `transitioned` is normally true here — the guard still
  // matters for the WS classifier tap and for a re-publish after a reconnect.
  const onTerminalState = async (payload: unknown): Promise<void> => {
    const decoded = decodeTerminalStatePayload(payload)
    if (decoded === undefined) return
    const now = ports.now()
    const applied = applyScreenEvent({
      existing: screens.get(decoded.short),
      short: decoded.short,
      state: decoded.state,
      matcher: decoded.matcher,
      now,
    })
    screens.set(decoded.short, applied.view)
    if (!applied.transitioned || paused) return
    await applyLiveFile({
      now,
      compute: (rulesFile) =>
        evaluateScreen({
          rules: rulesFile,
          screen: applied.view,
          prior: applied.prior,
          dwellMs: 0,
          now,
          history,
        }),
    })
  }

  // Drops BOTH readings of a removed session: a short that comes back is a
  // different occupant, and inheriting the previous one's dwell anchor would let
  // a dwell rule fire on a session that has existed for a second.
  const onSessionRemoved = (payload: unknown): void => {
    const short = decodeSessionRemovedPayload(payload)
    if (short === undefined) return
    sessions.delete(short)
    screens.delete(short)
  }

  let started = false

  const start = (): void => {
    if (started) return
    started = true
    // This engine lives for the daemon process's own lifetime once started
    // — nothing ever tears the subscription down early.
    sseBus.subscribe((event) => {
      if (event.type === "session.state") void onSessionState(event.data)
      else if (event.type === "terminal.state") void onTerminalState(event.data)
      else if (event.type === "session.removed") onSessionRemoved(event.data)
    })
  }

  // Both sweeps pass `prior` equal to the current state, which is what keeps a
  // transition-only rule from re-firing on every tick, and a dwell measured from
  // the view's own anchor.
  const supervisorOutcomes = ({
    rulesFile,
    view,
    now,
  }: {
    readonly rulesFile: RulesFile
    readonly view: SessionView
    readonly now: number
  }): ReadonlyArray<RuleOutcome> =>
    evaluate({
      rules: rulesFile,
      session: snapshotOf({ view, now }),
      prior: view.state,
      dwellMs: now - view.stateEnteredAt,
      now,
      history,
    })

  const screenOutcomes = ({
    rulesFile,
    view,
    now,
  }: {
    readonly rulesFile: RulesFile
    readonly view: ScreenView
    readonly now: number
  }): ReadonlyArray<RuleOutcome> =>
    evaluateScreen({
      rules: rulesFile,
      screen: view,
      prior: view.state,
      dwellMs: now - view.stateEnteredAt,
      now,
      history,
    })

  // Applied one view at a time on purpose: `history` is mutated by
  // applyOutcomes, so a session whose supervisor rule just fired has already
  // spent that budget by the time its screen rules are evaluated in the same
  // sweep. Computing every outcome up front first would hand each view an
  // identical stale history and let one sweep overshoot the per-session ceiling.
  const tick = async (): Promise<void> => {
    if (paused) return
    const { rulesFile, errors } = await readRulesFile(configDir)
    if (errors.length > 0 || !rulesFile.enabled) return
    const now = ports.now()
    for (const view of sessions.values()) {
      await applyOutcomes({ outcomes: supervisorOutcomes({ rulesFile, view, now }), now })
    }
    for (const view of screens.values()) {
      await applyOutcomes({ outcomes: screenOutcomes({ rulesFile, view, now }), now })
    }
  }

  const status = async (): Promise<RulesStatus> => {
    const { rulesFile, errors } = await readRulesFile(configDir)
    return { enabled: rulesFile.enabled, paused, errors, rules: rulesFile.rules, log: [...log] }
  }

  const pause = async (next: boolean): Promise<void> => {
    paused = next
  }

  // Fires nothing, so unlike `tick` it can compute both readings in one pass.
  const preview = async (): Promise<PreviewResult> => {
    const { rulesFile, errors } = await readRulesFile(configDir)
    if (errors.length > 0) return { errors, outcomes: [] }
    const now = ports.now()
    const outcomes = [
      ...[...sessions.values()].flatMap((view) => supervisorOutcomes({ rulesFile, view, now })),
      ...[...screens.values()].flatMap((view) => screenOutcomes({ rulesFile, view, now })),
    ]
    return { errors: [], outcomes }
  }

  return { start, status, pause, preview, tick }
}
