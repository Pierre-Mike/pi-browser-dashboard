import { useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { stateColor, stateTitle } from "../../lib/format"
import { PanelResizeHandle } from "../../lib/PanelResizeHandle"
import { PANEL_DEFAULT_WIDTH, usePanelDrag, usePersistedWidth } from "../../lib/panelResize"
import type { Project, SessionState } from "../../lib/types"
import { dispatchSpawn } from "../dispatch/spawnDispatch"
import { stopSession } from "../sessions/stopSession"
import { useSessions } from "../sessions/useSessions"
import { TerminalView } from "../terminal/TerminalView"
import {
  brainstormCompanionIntent,
  isBrainstormCompanionIntent,
  isLiveBrainstormCompanion,
} from "./brainstormPrompts"
import type { Brainstorm } from "./brainstorms"

type Props = {
  readonly project: Project
  readonly brainstorm: Brainstorm
}

const StartButton = ({
  busy,
  onStart,
}: {
  readonly busy: boolean
  readonly onStart: () => void
}) => (
  <button
    type="button"
    data-testid="brainstorm-session-start"
    onClick={onStart}
    disabled={busy}
    title="Start an AI session that knows this board's file — no fixed mission, just talk to it"
    className="btn btn-xs btn-primary normal-case"
  >
    {busy ? "…" : "New session"}
  </button>
)

// A chip per live session: the state dot + short id select whose terminal is
// shown, and the ✕ stops that session. No role label, no per-role colour — the
// only tint is the shared session-state tone, same as the V2 panel.
const SessionChip = ({
  session,
  active,
  onSelect,
  onStop,
}: {
  readonly session: SessionState
  readonly active: boolean
  readonly onSelect: () => void
  readonly onStop: () => void
}) => {
  const tone = stateColor(session.state)
  return (
    <span
      data-testid="brainstorm-session-chip"
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${tone.bg} ${tone.text} ${active ? `ring-1 ${tone.ring}` : ""}`}
      title={stateTitle(session.state, session.detail)}
    >
      <button
        type="button"
        data-testid={`brainstorm-session-select-${session.short}`}
        onClick={onSelect}
        className="inline-flex items-center gap-1"
      >
        <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
        {session.short}
      </button>
      <button
        type="button"
        aria-label="Stop this session"
        title="Stop this session"
        onClick={onStop}
        className="opacity-60 hover:opacity-100"
      >
        ✕
      </button>
    </span>
  )
}

const EmptyState = () => (
  <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-base-300 p-4 text-center text-xs text-base-content/60">
    Start a session to work on this board together — it knows the canvas file and nothing else; tell
    it what you want here. Start more than one to keep separate trains of thought.
  </div>
)

// Every live session attached to this board, recovered purely from the sessions
// list via the [brainstorm:<slug>] intent marker — no store. Several may match:
// the panel lists them all and switches between their terminals.
const findBoardSessions = (input: {
  readonly sessions: readonly SessionState[]
  readonly projectPath: string
  readonly slug: string
}): readonly SessionState[] =>
  input.sessions.filter(
    (s) =>
      s.cwd === input.projectPath &&
      isBrainstormCompanionIntent(s.intent, input.slug) &&
      isLiveBrainstormCompanion(s),
  )

// The session the terminal follows: the explicitly selected one while it still
// exists, else the first live one, else nothing.
const selectedSession = (
  sessions: readonly SessionState[],
  selectedShort: string | null,
): SessionState | null => sessions.find((s) => s.short === selectedShort) ?? sessions[0] ?? null

const HeaderRow = ({ busy, onStart }: { readonly busy: boolean; readonly onStart: () => void }) => (
  <div className="flex items-center gap-2">
    <span className="text-xs font-semibold text-base-content/80">AI sessions</span>
    <StartButton busy={busy} onStart={onStart} />
  </div>
)

const ErrorLine = ({ error }: { readonly error: string | null }) =>
  error === null ? null : (
    <span data-testid="brainstorm-session-error" className="text-[10px] text-error">
      {error}
    </span>
  )

const SessionChips = ({
  sessions,
  selected,
  onSelect,
  onStop,
}: {
  readonly sessions: readonly SessionState[]
  readonly selected: SessionState | null
  readonly onSelect: (short: string) => void
  readonly onStop: (short: string) => void
}) =>
  sessions.length === 0 ? null : (
    <div className="flex flex-wrap items-center gap-1" data-testid="brainstorm-session-chips">
      {sessions.map((s) => (
        <SessionChip
          key={s.short}
          session={s}
          active={selected?.short === s.short}
          onSelect={() => onSelect(s.short)}
          onStop={() => onStop(s.short)}
        />
      ))}
    </div>
  )

const CompanionBody = ({ session }: { readonly session: SessionState | null }) =>
  session === null ? (
    <EmptyState />
  ) : (
    <TerminalView
      key={session.short}
      kind="session"
      id={session.short}
      reconnectTitle="Reconnect to this session's terminal"
      testId="brainstorm-companion-terminal"
    />
  )

/**
 * The "AI by my side" panel for one brainstorm canvas: the simple V2 chat
 * design — one "New session" button that spawns a plain session knowing only
 * this board's file, no roles/missions/notes. Unlike V2 it allows several
 * sessions at once; a chip per session (state dot + short id) picks whose
 * terminal is shown, and the ✕ stops it. Sessions are recovered purely from the
 * sessions list via the [brainstorm:<slug>] intent marker — no extra store.
 */
export const BrainstormCompanion = ({ project, brainstorm }: Props) => {
  const qc = useQueryClient()
  const sessionsQ = useSessions()
  const sessions = findBoardSessions({
    sessions: sessionsQ.data ?? [],
    projectPath: project.path,
    slug: brainstorm.id,
  })

  const [selectedShort, setSelectedShort] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // User-draggable width, persisted per-browser. The handle on the panel's left
  // edge widens it as you drag left; double-click the handle resets to default.
  const { width, setWidth } = usePersistedWidth("pid:brainstorm:companion-width")
  const { onResizeStart, dragging } = usePanelDrag(width, setWidth)

  const selected = selectedSession(sessions, selectedShort)

  const refresh = () => qc.invalidateQueries({ queryKey: ["sessions"] })

  const start = () => {
    if (busy) return
    setBusy(true)
    setError(null)
    dispatchSpawn({
      intent: brainstormCompanionIntent({ slug: brainstorm.id, file: brainstorm.file }),
      project,
    })
      .then((short) => {
        // Follow the freshly spawned session so its terminal is shown at once.
        if (short) setSelectedShort(short)
        refresh()
      })
      .catch((err) => setError(err instanceof Error ? err.message : "spawn failed"))
      .finally(() => setBusy(false))
  }

  const stop = (short: string) => {
    stopSession(short)
      .then((ok) => {
        if (!ok) return setError("stop failed")
        // Drop the selection so the terminal falls back to another live session.
        if (short === selectedShort) setSelectedShort(null)
        refresh()
      })
      .catch(() => setError("stop failed"))
  }

  return (
    <aside
      data-testid="brainstorm-companion"
      style={{ width }}
      className={`relative flex shrink-0 flex-col gap-2 rounded-xl border border-base-300 bg-base-200/40 p-2 min-h-0 ${
        dragging ? "select-none" : ""
      }`}
    >
      <PanelResizeHandle
        testid="brainstorm-companion-resize"
        ariaLabel="Resize AI sessions panel"
        onResizeStart={onResizeStart}
        onReset={() => setWidth(PANEL_DEFAULT_WIDTH)}
        onNudge={(delta) => setWidth(width + delta)}
      />
      <HeaderRow busy={busy} onStart={start} />
      <ErrorLine error={error} />
      <SessionChips
        sessions={sessions}
        selected={selected}
        onSelect={setSelectedShort}
        onStop={stop}
      />
      <div className="flex-1 min-h-0">
        <CompanionBody session={selected} />
      </div>
    </aside>
  )
}
