import { useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { stateColor, stateTitle } from "../../lib/format"
import { PanelResizeHandle } from "../../lib/PanelResizeHandle"
import { PANEL_DEFAULT_WIDTH, usePanelDrag, usePersistedWidth } from "../../lib/panelResize"
import type { Project, SessionState } from "../../lib/types"
import type { Brainstorm } from "../brainstorms/brainstorms"
import { dispatchSpawn } from "../dispatch/spawnDispatch"
import { stopSession } from "../sessions/stopSession"
import { useSessions } from "../sessions/useSessions"
import { TerminalView } from "../terminal/TerminalView"
import {
  excalidrawCompanionIntent,
  isExcalidrawCompanionIntent,
  isLiveExcalidrawCompanion,
} from "./excalidrawPrompt"

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
    data-testid="excalidraw-session-start"
    onClick={onStart}
    disabled={busy}
    title="Start an AI session that knows this drawing's file — no fixed mission, just talk to it"
    className="btn btn-sm btn-primary normal-case"
  >
    {busy ? "…" : "Start session"}
  </button>
)

const SessionChip = ({
  session,
  onStop,
}: {
  readonly session: SessionState
  readonly onStop: () => void
}) => {
  const tone = stateColor(session.state)
  return (
    <span
      data-testid="excalidraw-session-chip"
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${tone.bg} ${tone.text}`}
      title={stateTitle(session.state, session.detail)}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
      {session.short}
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
    Start a session to work on this drawing together — it knows the board's file and nothing else;
    tell it what you want here.
  </div>
)

// The one live session attached to this board, recovered purely from the
// sessions list via the [excalidraw:<slug>] intent marker.
const findBoardSession = (input: {
  readonly sessions: readonly SessionState[]
  readonly projectPath: string
  readonly slug: string
}): SessionState | null =>
  input.sessions.find(
    (s) =>
      s.cwd === input.projectPath &&
      isExcalidrawCompanionIntent(s.intent, input.slug) &&
      isLiveExcalidrawCompanion(s),
  ) ?? null

const HeaderRow = ({
  session,
  busy,
  onStart,
  onStop,
}: {
  readonly session: SessionState | null
  readonly busy: boolean
  readonly onStart: () => void
  readonly onStop: (short: string) => void
}) => (
  <div className="flex items-center gap-2">
    <span className="text-xs font-semibold text-base-content/80">AI session</span>
    {session === null ? (
      <StartButton busy={busy} onStart={onStart} />
    ) : (
      <SessionChip session={session} onStop={() => onStop(session.short)} />
    )}
  </div>
)

const ErrorLine = ({ error }: { readonly error: string | null }) =>
  error === null ? null : (
    <span data-testid="excalidraw-session-error" className="text-[10px] text-error">
      {error}
    </span>
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
      testId="excalidraw-companion-terminal"
    />
  )

/**
 * The V2 companion panel: no role buttons, no missions — one plain session
 * whose entire context is "we are working on this Excalidraw file right now",
 * and the embedded terminal is the conversation. The session is recovered
 * purely from the sessions list via the [excalidraw:<slug>] intent marker.
 */
export const ExcalidrawCompanion = ({ project, brainstorm }: Props) => {
  const qc = useQueryClient()
  const sessionsQ = useSessions()
  const session = findBoardSession({
    sessions: sessionsQ.data ?? [],
    projectPath: project.path,
    slug: brainstorm.id,
  })

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { width, setWidth } = usePersistedWidth("pid:excalidraw:companion-width")
  const { onResizeStart, dragging } = usePanelDrag(width, setWidth)

  const refresh = () => qc.invalidateQueries({ queryKey: ["sessions"] })

  const start = () => {
    if (busy) return
    setBusy(true)
    setError(null)
    dispatchSpawn({
      intent: excalidrawCompanionIntent({ slug: brainstorm.id, file: brainstorm.file }),
      project,
    })
      .then(refresh)
      .catch((err) => setError(err instanceof Error ? err.message : "spawn failed"))
      .finally(() => setBusy(false))
  }

  const stop = (short: string) => {
    stopSession(short)
      .then((ok) => (ok ? refresh() : setError("stop failed")))
      .catch(() => setError("stop failed"))
  }

  return (
    <aside
      data-testid="excalidraw-companion"
      style={{ width }}
      className={`relative flex shrink-0 flex-col gap-2 rounded-xl border border-base-300 bg-base-200/40 p-2 min-h-0 ${
        dragging ? "select-none" : ""
      }`}
    >
      <PanelResizeHandle
        testid="excalidraw-companion-resize"
        ariaLabel="Resize AI session panel"
        onResizeStart={onResizeStart}
        onReset={() => setWidth(PANEL_DEFAULT_WIDTH)}
        onNudge={(delta) => setWidth(width + delta)}
      />
      <HeaderRow session={session} busy={busy} onStart={start} onStop={stop} />
      <ErrorLine error={error} />
      <div className="flex-1 min-h-0">
        <CompanionBody session={session} />
      </div>
    </aside>
  )
}
