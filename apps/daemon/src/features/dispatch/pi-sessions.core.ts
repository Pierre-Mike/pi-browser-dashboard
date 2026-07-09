// Pure helpers for surfacing daemon-spawned pi runs as session cards. pi has
// no supervisor: the only ground truth is the transcript pi writes under
// ~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<id>.jsonl plus the child
// pid the daemon recorded at spawn. Everything here is data-in/data-out;
// pi-sessions.repo.ts owns the file reads and pid probes.
import type { SessionState, SessionStateSlug } from "../sessions/sessions.core"

// One dispatched pi run, as recorded by the spawn log at launch time.
export type PiSpawnRecord = {
  readonly id: string
  readonly pid: number
  readonly cwd: string
  readonly intent: string
  readonly spawnedAt: string
}

// pi's session-dir name for a cwd: strip the leading slash, turn the rest's
// slashes into dashes, fence with double dashes. pi resolves symlinks first
// (macOS /tmp → /private/tmp), so callers must pass a realpath.
export const encodePiSessionDir = (realCwd: string): string =>
  `--${realCwd.slice(1).replaceAll("/", "-")}--`

export const isPiSessionFile = (fileName: string, id: string): boolean =>
  fileName.endsWith(`_${id}.jsonl`)

export type PiTranscriptMeta = {
  // True when the transcript's final message entry is an assistant reply —
  // a `pi -p` run writes it last, so this marks a run that finished its turn.
  readonly endedClean: boolean
  readonly lastAssistantText: string | undefined
}

type TranscriptMessage = {
  readonly role?: unknown
  readonly content?: unknown
}

const textOf = (message: TranscriptMessage): string | undefined => {
  if (!Array.isArray(message.content)) return undefined
  const texts = message.content
    .map((part) => (part as { type?: unknown; text?: unknown } | null) ?? {})
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
  return texts.length > 0 ? texts.join("\n") : undefined
}

const lastMessageEntry = (jsonl: string): TranscriptMessage | undefined => {
  let last: TranscriptMessage | undefined
  for (const raw of jsonl.split(/\r?\n/)) {
    if (!raw.trim()) continue
    let entry: { type?: unknown; message?: unknown }
    try {
      entry = JSON.parse(raw) as { type?: unknown; message?: unknown }
    } catch {
      continue
    }
    if (entry.type !== "message" || typeof entry.message !== "object" || entry.message === null) {
      continue
    }
    last = entry.message as TranscriptMessage
  }
  return last
}

export const parsePiTranscript = (jsonl: string): PiTranscriptMeta => {
  const last = lastMessageEntry(jsonl)
  const endedClean = last?.role === "assistant"
  return {
    endedClean,
    lastAssistantText: endedClean && last ? textOf(last) : undefined,
  }
}

export type PiStateInput = {
  readonly endedClean: boolean
  readonly pidAlive: boolean
}

// A finished transcript outranks the pid probe: the process may linger a
// moment after its final write, and after a daemon restart pids can be
// recycled. A run that never finished and whose process is gone died mid-run.
export const derivePiState = ({ endedClean, pidAlive }: PiStateInput): SessionStateSlug => {
  if (endedClean) return "done"
  return pidAlive ? "working" : "failed"
}

export type PiSessionInput = {
  readonly spawn: PiSpawnRecord
  readonly state: SessionStateSlug
  readonly lastAssistantText: string | undefined
  readonly updatedAt: string | undefined
}

export const piShort = (id: string): string => id.slice(0, 8)

export const piSpawnToSession = ({
  spawn,
  state,
  lastAssistantText,
  updatedAt,
}: PiSessionInput): SessionState => ({
  short: piShort(spawn.id),
  state,
  detail: spawn.intent,
  tempo: undefined,
  intent: spawn.intent,
  name: `pi · ${piShort(spawn.id)}`,
  sessionId: spawn.id,
  cwd: spawn.cwd,
  createdAt: spawn.spawnedAt,
  updatedAt: updatedAt ?? spawn.spawnedAt,
  linkScanPath: undefined,
  worktreePath: undefined,
  worktreeBranch: undefined,
  result: lastAssistantText,
  harness: "pi",
})
