import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Context, Layer } from "effect"
import { resolveConfigDir } from "../../platform/config-dir"
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

/**
 * What `GET /sessions/:id/explain` needs beyond the `SessionState` itself, in
 * the same shape the claude registry's `diagnostics` returns — so the route can
 * hand either one to the shared explanation builder without branching on which
 * harness it got.
 *
 * Two fields are constants here rather than probes, and that is the point:
 * `stateFilePresent` is always `false` because pi writes no per-session status
 * file, and `lastEventAtMs` is always `undefined` because the daemon keeps no
 * event history for a pi short. Reporting them as unknown-shaped facts is what
 * stops the explanation from implying a file-based provenance pi never had.
 */
export type PiSessionDiagnostics = {
  readonly session: SessionState
  readonly updatedAtMs: number | undefined
  readonly lastEventAtMs: undefined
  readonly pidAlive: boolean
  readonly stateFilePresent: false
  // pi's transcript is the only artifact pi itself produces; its absence means
  // the state rests on the pid probe alone.
  readonly piTranscriptPresent: boolean
}

export type PiSessionsApi = {
  readonly config: PiSessionsConfig
  readonly record: (spawn: PiSpawnRecord) => void
  readonly list: () => SessionState[]
  // Accepts the exposed short or the full session id; true when an entry
  // was actually dropped.
  readonly remove: (short: string) => boolean
  readonly getOne: (short: string) => SessionState | undefined
  // Same short/id resolution as getOne. `undefined` when this daemon never
  // spawned the run.
  readonly diagnostics: (short: string) => PiSessionDiagnostics | undefined
}

export class PiSessionsIo extends Context.Tag("PiSessionsIo")<PiSessionsIo, PiSessionsApi>() {}

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
  const name = entries.find((entry) => isPiSessionFile({ fileName: entry, id: spawn.id }))
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
    diagnostics: (short) => {
      const spawn = spawns.find((s) => matches(s, short))
      if (!spawn) return undefined
      const session = sessionFor(config, spawn)
      return {
        session,
        updatedAtMs: session.updatedAt === undefined ? undefined : Date.parse(session.updatedAt),
        lastEventAtMs: undefined,
        // Probed here rather than reused from sessionFor's own probe: a stale
        // boolean is exactly the thing this endpoint exists to not hand out.
        pidAlive: config.isPidAlive(spawn.pid),
        stateFilePresent: false,
        piTranscriptPresent: findTranscript(config, spawn) !== undefined,
      }
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

// The spawn log lives under the (config-dir keyed) claude config root, so any
// sandboxed run — e2e sets CLAUDE_CONFIG_DIR — automatically gets its own
// empty log instead of the user's. Env overrides cover everything else.
export const PiSessionsIoLive: Layer.Layer<PiSessionsIo> = Layer.succeed(
  PiSessionsIo,
  makePiSessionsApi({
    spawnsFile: process.env.PID_PI_SPAWNS_FILE ?? path.join(resolveConfigDir(), "pi-spawns.json"),
    sessionsRoot:
      process.env.PID_PI_SESSIONS_ROOT ?? path.join(os.homedir(), ".pi", "agent", "sessions"),
    isPidAlive: defaultIsPidAlive,
  }),
)
