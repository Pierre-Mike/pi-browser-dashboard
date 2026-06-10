import fs from "node:fs"
import path from "node:path"
import { Context, Effect, Layer, type Scope } from "effect"
import { resolveConfigDir } from "../../platform/config-dir"
import { type FsWatchUnsubscribe, watchFile } from "../../platform/fswatch.repo"
import { sseBus } from "../../platform/sse-bus"
import {
  backfillRosterFields,
  mergeStateWithPrior,
  type ParsedRoster,
  parseRoster,
  parseState,
  type SessionState,
  seedFromWorker,
} from "./sessions.core"

const MAX_PARSE_RETRIES = 5
const PARSE_RETRY_MS = 50

const readJsonWithRetry = async (filePath: string): Promise<unknown | null> => {
  for (let attempt = 0; attempt < MAX_PARSE_RETRIES; attempt++) {
    let raw: string
    try {
      raw = await fs.promises.readFile(filePath, "utf8")
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code
      if (code === "ENOENT") return null
      throw err
    }
    if (!raw.trim()) {
      // Empty mid-write — back off and retry.
      await new Promise<void>((resolve) => setTimeout(resolve, PARSE_RETRY_MS))
      continue
    }
    try {
      return JSON.parse(raw) as unknown
    } catch (err) {
      if (!(err instanceof SyntaxError) || attempt === MAX_PARSE_RETRIES - 1) {
        throw err
      }
      await new Promise<void>((resolve) => setTimeout(resolve, PARSE_RETRY_MS))
    }
  }
  return null
}

export type SessionRegistryApi = {
  readonly snapshot: () => ReadonlyArray<SessionState>
  readonly getOne: (short: string) => SessionState | undefined
}

export class SessionRegistry extends Context.Tag("SessionRegistry")<
  SessionRegistry,
  SessionRegistryApi
>() {}

const rosterPathFor = (configDir: string): string => path.join(configDir, "daemon", "roster.json")
const statePathFor = (configDir: string, short: string): string =>
  path.join(configDir, "jobs", short, "state.json")

type RegistryState = {
  readonly sessions: Map<string, SessionState>
  readonly stateWatchers: Map<string, FsWatchUnsubscribe>
  rosterWatcher: FsWatchUnsubscribe | null
  rosterShorts: ReadonlySet<string>
}

const removeSession = ({ reg, short }: { reg: RegistryState; short: string }): void => {
  reg.sessions.delete(short)
  const stop = reg.stateWatchers.get(short)
  if (stop) {
    stop()
    reg.stateWatchers.delete(short)
  }
  sseBus.publish({ type: "session.removed", data: { short } })
}

// A worker dropping out of the roster only means the supervisor no longer
// runs it — the job dir (state.json, transcript link) persists until the user
// runs `claude rm`. Keep those sessions listed; only forget ones whose
// state.json is gone too.
const dropDepartedSessions = ({
  reg,
  configDir,
  presentShorts,
}: {
  reg: RegistryState
  configDir: string
  presentShorts: ReadonlySet<string>
}): void => {
  for (const short of Array.from(reg.sessions.keys())) {
    if (presentShorts.has(short)) continue
    if (fs.existsSync(statePathFor(configDir, short))) continue
    removeSession({ reg, short })
  }
}

const upsertRosterWorker = ({
  reg,
  configDir,
  worker,
}: {
  reg: RegistryState
  configDir: string
  worker: ParsedRoster["workers"][number]
}): void => {
  const existing = reg.sessions.get(worker.short)
  if (existing) {
    // Jobs-dir scan may have seeded this session from state.json before the
    // roster was read — backfill roster-only fields it couldn't know.
    const merged = backfillRosterFields({ existing, worker })
    if (merged) {
      reg.sessions.set(worker.short, merged)
      sseBus.publish({ type: "session.state", data: merged })
    }
    return
  }
  // Seed with minimal info from roster; state.json watcher fills the rest.
  const seed = seedFromWorker(worker)
  reg.sessions.set(worker.short, seed)
  sseBus.publish({ type: "session.created", data: seed })
  attachStateWatcher({ reg, configDir, short: worker.short })
}

const reconcileRoster = async ({
  reg,
  configDir,
  parsed,
}: {
  reg: RegistryState
  configDir: string
  parsed: ParsedRoster
}): Promise<void> => {
  const presentShorts = new Set(parsed.workers.map((w) => w.short))
  reg.rosterShorts = presentShorts
  dropDepartedSessions({ reg, configDir, presentShorts })
  for (const worker of parsed.workers) {
    upsertRosterWorker({ reg, configDir, worker })
  }
  sseBus.publish({
    type: "roster.changed",
    data: { workers: parsed.workers, updatedAt: parsed.updatedAt },
  })
}

const refreshState = async ({
  reg,
  configDir,
  short,
}: {
  reg: RegistryState
  configDir: string
  short: string
}): Promise<void> => {
  const filePath = statePathFor(configDir, short)
  let json: unknown
  try {
    json = await readJsonWithRetry(filePath)
  } catch (err) {
    console.error("[sessions.repo] failed to read state.json", short, err)
    return
  }
  if (json === null) {
    forgetIfJobRemoved({ reg, short, filePath })
    return
  }
  let parsed: SessionState
  try {
    parsed = parseState({ short, json })
  } catch (err) {
    console.error("[sessions.repo] failed to parse state.json", short, err)
    return
  }
  // Preserve any roster-derived fields if state.json hasn't filled them yet.
  const merged = mergeStateWithPrior({ parsed, prior: reg.sessions.get(short) })
  reg.sessions.set(short, merged)
  sseBus.publish({ type: "session.state", data: merged })
}

// state.json gone for a session the supervisor no longer tracks either: the
// user removed the job (`claude rm`). Roster-tracked sessions keep their
// snapshot — the file may simply not exist yet (spawn in flight).
const forgetIfJobRemoved = ({
  reg,
  short,
  filePath,
}: {
  reg: RegistryState
  short: string
  filePath: string
}): void => {
  if (reg.rosterShorts.has(short)) return
  if (!reg.sessions.has(short)) return
  if (fs.existsSync(filePath)) return
  removeSession({ reg, short })
}

const attachStateWatcher = ({
  reg,
  configDir,
  short,
}: {
  reg: RegistryState
  configDir: string
  short: string
}): void => {
  if (reg.stateWatchers.has(short)) return
  const filePath = statePathFor(configDir, short)
  // Initial read.
  void refreshState({ reg, configDir, short })
  const unsub = watchFile(filePath, () => {
    void refreshState({ reg, configDir, short })
  })
  reg.stateWatchers.set(short, unsub)
}

// Seed the registry from jobs/*/state.json so sessions the supervisor no
// longer tracks (daemon restart, supervisor restart) stay listed until the
// user removes them with `claude rm`.
const scanJobsDir = ({ reg, configDir }: { reg: RegistryState; configDir: string }): void => {
  let entries: string[]
  try {
    entries = fs.readdirSync(path.join(configDir, "jobs"))
  } catch {
    return // no jobs dir yet
  }
  for (const short of entries) {
    if (!fs.existsSync(statePathFor(configDir, short))) continue
    attachStateWatcher({ reg, configDir, short })
  }
}

const refreshRoster = async (reg: RegistryState, configDir: string): Promise<void> => {
  const filePath = rosterPathFor(configDir)
  let json: unknown
  try {
    json = await readJsonWithRetry(filePath)
  } catch (err) {
    console.error("[sessions.repo] failed to read roster.json", err)
    return
  }
  if (json === null) {
    // Treat missing roster as empty.
    await reconcileRoster({
      reg,
      configDir,
      parsed: {
        supervisorPid: undefined,
        updatedAt: undefined,
        workers: [],
      },
    })
    return
  }
  let parsed: ParsedRoster
  try {
    parsed = parseRoster(json)
  } catch (err) {
    console.error("[sessions.repo] failed to parse roster.json", err)
    return
  }
  await reconcileRoster({ reg, configDir, parsed })
}

const buildRegistry = (): Effect.Effect<SessionRegistryApi, never, Scope.Scope> =>
  Effect.gen(function* () {
    const configDir = resolveConfigDir()
    const reg: RegistryState = {
      sessions: new Map(),
      stateWatchers: new Map(),
      rosterWatcher: null,
      rosterShorts: new Set(),
    }

    // Initial sync + watcher arm.
    scanJobsDir({ reg, configDir })
    yield* Effect.promise(() => refreshRoster(reg, configDir))
    reg.rosterWatcher = watchFile(rosterPathFor(configDir), () => {
      void refreshRoster(reg, configDir)
    })

    // Register cleanup.
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        if (reg.rosterWatcher) {
          reg.rosterWatcher()
          reg.rosterWatcher = null
        }
        for (const stop of reg.stateWatchers.values()) stop()
        reg.stateWatchers.clear()
        reg.sessions.clear()
      }),
    )

    return {
      snapshot: () => Array.from(reg.sessions.values()),
      getOne: (short: string) => reg.sessions.get(short),
    }
  })

export const SessionRegistryLive: Layer.Layer<SessionRegistry> = Layer.scoped(
  SessionRegistry,
  buildRegistry(),
)
