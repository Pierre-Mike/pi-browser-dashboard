import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Context, Layer } from "effect"
import type { SessionState } from "../sessions/sessions.core"
import {
  derivePiState,
  encodePiSessionDir,
  isPiSessionFile,
  type PiSpawnRecord,
  parsePiTranscript,
  piShort,
  piSpawnToSession,
} from "./pi-sessions.core"

// pi runs have no supervisor roster, so the daemon keeps its own log of the
// spawns it launched — that log (plus pi's transcripts) is what the dashboard
// lists. Only daemon-spawned runs appear: scanning all of ~/.pi would flood
// the grid with every interactive pi session the user ever ran.
export type PiSessionsConfig = {
  readonly spawnsFile: string
  readonly sessionsRoot: string
  readonly isPidAlive: (pid: number) => boolean
}

export type PiSessionsApi = {
  readonly config: PiSessionsConfig
  readonly record: (spawn: PiSpawnRecord) => void
  readonly list: () => SessionState[]
  // Accepts the exposed short or the full session id; true when an entry
  // was actually dropped.
  readonly remove: (short: string) => boolean
  readonly getOne: (short: string) => SessionState | undefined
}

export class PiSessionsRepo extends Context.Tag("PiSessionsRepo")<
  PiSessionsRepo,
  PiSessionsApi
>() {}

const MAX_SPAWNS = 100

const loadSpawns = (spawnsFile: string): PiSpawnRecord[] => {
  let raw: string
  try {
    raw = fs.readFileSync(spawnsFile, "utf8")
  } catch {
    return []
  }
  try {
    const parsed = JSON.parse(raw) as { spawns?: unknown }
    return Array.isArray(parsed.spawns) ? (parsed.spawns as PiSpawnRecord[]) : []
  } catch {
    return []
  }
}

const saveSpawns = (spawnsFile: string, spawns: readonly PiSpawnRecord[]): void => {
  fs.mkdirSync(path.dirname(spawnsFile), { recursive: true })
  fs.writeFileSync(spawnsFile, JSON.stringify({ spawns }, null, 2))
}

// pi encodes the *resolved* cwd into its session-dir name (macOS /tmp is
// really /private/tmp). Fall back to the recorded path when it's gone.
const realpathOr = (p: string): string => {
  try {
    return fs.realpathSync(p)
  } catch {
    return p
  }
}

const findTranscript = (
  { sessionsRoot }: PiSessionsConfig,
  spawn: PiSpawnRecord,
): string | undefined => {
  const dir = path.join(sessionsRoot, encodePiSessionDir(realpathOr(spawn.cwd)))
  let entries: string[]
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return undefined
  }
  const name = entries.find((entry) => isPiSessionFile(entry, spawn.id))
  return name ? path.join(dir, name) : undefined
}

const sessionFor = (config: PiSessionsConfig, spawn: PiSpawnRecord): SessionState => {
  const pidAlive = config.isPidAlive(spawn.pid)
  const transcriptPath = findTranscript(config, spawn)
  if (!transcriptPath) {
    // No transcript yet: either just spawned (pi hasn't written it) or the
    // process died before ever starting a session.
    return piSpawnToSession({
      spawn,
      state: pidAlive ? "working" : "failed",
      lastAssistantText: undefined,
      updatedAt: undefined,
    })
  }
  let text = ""
  let updatedAt: string | undefined
  try {
    text = fs.readFileSync(transcriptPath, "utf8")
    updatedAt = fs.statSync(transcriptPath).mtime.toISOString()
  } catch {
    // Raced a delete — treat as not-yet-written.
  }
  const meta = parsePiTranscript(text)
  return piSpawnToSession({
    spawn,
    state: derivePiState({ endedClean: meta.endedClean, pidAlive }),
    lastAssistantText: meta.lastAssistantText,
    updatedAt,
  })
}

export const makePiSessionsApi = (config: PiSessionsConfig): PiSessionsApi => {
  let spawns = loadSpawns(config.spawnsFile)
  const matches = (spawn: PiSpawnRecord, short: string): boolean =>
    spawn.id === short || piShort(spawn.id) === short
  return {
    config,
    record: (spawn) => {
      spawns = [spawn, ...spawns.filter((s) => s.id !== spawn.id)].slice(0, MAX_SPAWNS)
      saveSpawns(config.spawnsFile, spawns)
    },
    list: () => spawns.map((spawn) => sessionFor(config, spawn)),
    remove: (short) => {
      const next = spawns.filter((spawn) => !matches(spawn, short))
      if (next.length === spawns.length) return false
      spawns = next
      saveSpawns(config.spawnsFile, spawns)
      return true
    },
    getOne: (short) => {
      const spawn = spawns.find((s) => matches(s, short))
      return spawn ? sessionFor(config, spawn) : undefined
    },
  }
}

const defaultIsPidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// Env overrides keep sandboxed runs (e2e) off the user's real spawn log and
// pi session store, mirroring the other PID_* sandbox knobs in global-setup.
export const PiSessionsRepoLive: Layer.Layer<PiSessionsRepo> = Layer.succeed(
  PiSessionsRepo,
  makePiSessionsApi({
    spawnsFile: process.env.PID_PI_SPAWNS_FILE ?? path.join(os.homedir(), ".pid", "pi-spawns.json"),
    sessionsRoot:
      process.env.PID_PI_SESSIONS_ROOT ?? path.join(os.homedir(), ".pi", "agent", "sessions"),
    isPidAlive: defaultIsPidAlive,
  }),
)
