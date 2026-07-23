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
  COMPANION_ROLES,
  type CompanionRole,
  type CompanionRoleSpec,
  companionIntent,
  companionRoleFromIntent,
  companionToggle,
  isCompanionIntent,
  isLiveCompanion,
  runningCompanion,
} from "./brainstormPrompts"
import type { Brainstorm } from "./brainstorms"

type Props = {
  readonly project: Project
  readonly brainstorm: Brainstorm
}

type ActionResult = {
  readonly kind: "spawned" | "stopped" | "stop_failed"
  readonly short: string | null
}

// Role buttons are toggles: clicking a role with a live companion stops it
// (unselect), otherwise it spawns a fresh one (select). Kept outside the
// component so the button handler stays a thin state adapter.
const runCompanionAction = async (input: {
  readonly companions: readonly SessionState[]
  readonly role: CompanionRole
  readonly note: string
  readonly brainstorm: Brainstorm
  readonly project: Project
}): Promise<ActionResult> => {
  const action = companionToggle(input.companions, input.role)
  if (action.kind === "stop") {
    const ok = await stopSession(action.short)
    return { kind: ok ? "stopped" : "stop_failed", short: action.short }
  }
  const short = await dispatchSpawn({
    intent: companionIntent({
      role: input.role,
      slug: input.brainstorm.id,
      file: input.brainstorm.file,
      extra: input.note,
    }),
    project: input.project,
  })
  return { kind: "spawned", short }
}

const statusLine = (kind: ActionResult["kind"], role: CompanionRole): string =>
  ({
    spawned: `spawned ${role}`,
    stopped: `stopped ${role}`,
    stop_failed: `stop failed (${role})`,
  })[kind]

const roleButtonClass = (selected: boolean): string =>
  `btn btn-xs justify-start gap-1.5 normal-case ${
    selected ? "btn-primary" : "bg-base-100 border-base-300 hover:border-primary/40"
  }`

// One toggle button. A live companion for this role makes it "selected"
// (primary fill + a state dot); clicking it then stops that companion, and
// clicking an unselected role spawns one.
const RoleButton = ({
  spec,
  running,
  busy,
  acting,
  onAct,
}: {
  readonly spec: CompanionRoleSpec
  readonly running: SessionState | undefined
  readonly busy: boolean
  readonly acting: boolean
  readonly onAct: () => void
}) => {
  const selected = running !== undefined
  return (
    <button
      type="button"
      aria-pressed={selected}
      data-testid={`brainstorm-role-${spec.role}`}
      data-selected={selected}
      onClick={onAct}
      disabled={busy}
      title={selected ? `${spec.title} — click to stop this companion` : spec.title}
      className={roleButtonClass(selected)}
    >
      {running ? (
        <span className={`h-1.5 w-1.5 rounded-full ${stateColor(running.state).dot}`} />
      ) : null}
      <span className="truncate">{acting ? "…" : spec.label}</span>
    </button>
  )
}

const RoleButtons = ({
  companions,
  busyRole,
  onAct,
}: {
  readonly companions: readonly SessionState[]
  readonly busyRole: CompanionRole | null
  readonly onAct: (role: CompanionRole) => void
}) => (
  <div className="grid grid-cols-2 gap-1">
    {COMPANION_ROLES.map((spec) => (
      <RoleButton
        key={spec.role}
        spec={spec}
        running={runningCompanion(companions, spec.role)}
        busy={busyRole !== null}
        acting={busyRole === spec.role}
        onAct={() => onAct(spec.role)}
      />
    ))}
  </div>
)

const CompanionChip = ({
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
  const role = companionRoleFromIntent(session.intent) ?? "companion"
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${tone.bg} ${tone.text} ${active ? `ring-1 ${tone.ring}` : ""}`}
    >
      <button
        type="button"
        data-testid={`brainstorm-chip-${session.short}`}
        onClick={onSelect}
        title={stateTitle(session.state, session.detail)}
        className="inline-flex items-center gap-1"
      >
        <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
        {role}
      </button>
      <button
        type="button"
        aria-label={`Stop ${role} companion`}
        title="Stop this companion"
        onClick={onStop}
        className="opacity-60 hover:opacity-100"
      >
        ✕
      </button>
    </span>
  )
}

// The chip the terminal follows: the explicitly selected companion when it
// still exists, else the first live one, else nothing.
const selectedCompanion = (
  companions: readonly SessionState[],
  selectedShort: string | null,
): SessionState | null => companions.find((s) => s.short === selectedShort) ?? companions[0] ?? null

const CompanionHeader = ({ status }: { readonly status: string | null }) => (
  <div className="flex items-center gap-2">
    <span className="text-xs font-semibold text-base-content/80">AI companions</span>
    {status ? (
      <span data-testid="brainstorm-companion-status" className="text-[10px] text-base-content/60">
        {status}
      </span>
    ) : null}
  </div>
)

const CompanionChips = ({
  companions,
  selected,
  onSelect,
  onStop,
}: {
  readonly companions: readonly SessionState[]
  readonly selected: SessionState | null
  readonly onSelect: (short: string) => void
  readonly onStop: (short: string) => void
}) =>
  companions.length === 0 ? null : (
    <div className="flex flex-wrap items-center gap-1" data-testid="brainstorm-companion-chips">
      {companions.map((s) => (
        <CompanionChip
          key={s.short}
          session={s}
          active={selected?.short === s.short}
          onSelect={() => onSelect(s.short)}
          onStop={() => onStop(s.short)}
        />
      ))}
    </div>
  )

const CompanionTerminal = ({ selected }: { readonly selected: SessionState | null }) =>
  selected ? (
    <TerminalView
      key={selected.short}
      kind="session"
      id={selected.short}
      reconnectTitle="Reconnect to this companion's terminal"
      testId="brainstorm-companion-terminal"
    />
  ) : (
    <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-base-300 p-4 text-center text-xs text-base-content/60">
      Pick a role above to summon an AI companion for this board — it reads and draws on the canvas
      live, and chats with you here.
    </div>
  )

/**
 * The "AI by my side" panel for one brainstorm: each role button toggles a
 * focused companion session — click to spawn it, click again to stop it — a
 * chip per companion selects whose terminal is shown, and the embedded terminal
 * is the chat with the selected companion. Companions are recovered purely from
 * the sessions list via the intent marker — no extra store.
 */
export const BrainstormCompanion = ({ project, brainstorm }: Props) => {
  const qc = useQueryClient()
  const sessionsQ = useSessions()
  // Live companions only: stopping one (button toggle-off or chip ✕) drops it
  // from the panel, so "remove" actually removes rather than leaving a dead chip.
  const companions = (sessionsQ.data ?? []).filter(
    (s) =>
      s.cwd === project.path && isCompanionIntent(s.intent, brainstorm.id) && isLiveCompanion(s),
  )

  const [selectedShort, setSelectedShort] = useState<string | null>(null)
  const [note, setNote] = useState("")
  const [busyRole, setBusyRole] = useState<CompanionRole | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  // User-draggable width, persisted per-browser. The handle on the panel's left
  // edge widens it as you drag left; double-click the handle resets to default.
  const { width, setWidth } = usePersistedWidth("pid:brainstorm:companion-width")
  const { onResizeStart, dragging } = usePanelDrag(width, setWidth)

  const selected = selectedCompanion(companions, selectedShort)

  const flashStatus = (msg: string) => {
    setStatus(msg)
    setTimeout(() => setStatus(null), 4_000)
  }

  const afterAction = (result: ActionResult, role: CompanionRole) => {
    // Spawning and stopping both change the roster, so always refetch.
    qc.invalidateQueries({ queryKey: ["sessions"] })
    // Follow a freshly spawned companion; on a stop, drop the selection so the
    // terminal falls back to another live companion (or the empty state).
    if (result.kind === "spawned") setSelectedShort(result.short)
    else if (result.kind === "stopped") setSelectedShort(null)
    flashStatus(statusLine(result.kind, role))
    setNote("")
  }

  const act = (role: CompanionRole) => {
    if (busyRole !== null) return
    setBusyRole(role)
    runCompanionAction({ companions, role, note, brainstorm, project })
      .then((result) => afterAction(result, role))
      .catch((err) => flashStatus(`failed: ${err instanceof Error ? err.message : "unknown"}`))
      .finally(() => setBusyRole(null))
  }

  const stop = (short: string) => {
    stopSession(short)
      .then((ok) => {
        if (!ok) return flashStatus("stop failed")
        if (short === selectedShort) setSelectedShort(null)
        qc.invalidateQueries({ queryKey: ["sessions"] })
      })
      .catch(() => flashStatus("stop failed"))
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
        ariaLabel="Resize AI companions panel"
        onResizeStart={onResizeStart}
        onReset={() => setWidth(PANEL_DEFAULT_WIDTH)}
        onNudge={(delta) => setWidth(width + delta)}
      />
      <CompanionHeader status={status} />

      <RoleButtons companions={companions} busyRole={busyRole} onAct={act} />

      <input
        data-testid="brainstorm-note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="optional note for the AI…"
        className="input input-bordered input-xs w-full"
      />

      <CompanionChips
        companions={companions}
        selected={selected}
        onSelect={setSelectedShort}
        onStop={stop}
      />

      <div className="flex-1 min-h-0">
        <CompanionTerminal selected={selected} />
      </div>
    </aside>
  )
}
