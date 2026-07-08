import { useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { api } from "../../lib/api"
import { stateColor, stateTitle } from "../../lib/format"
import type { Project, SessionState } from "../../lib/types"
import { dispatchSpawn } from "../dispatch/spawnDispatch"
import { useSessions } from "../sessions/useSessions"
import { TerminalView } from "../terminal/TerminalView"
import {
  COMPANION_ROLES,
  type CompanionRole,
  companionIntent,
  companionNudge,
  companionRoleFromIntent,
  isCompanionIntent,
} from "./brainstormPrompts"
import type { Brainstorm } from "./brainstorms"

type Props = {
  readonly project: Project
  readonly brainstorm: Brainstorm
}

// A dead session can't take keystrokes; anything else (working, done, idle,
// blocked, needs_input) still has a live REPL behind `claude attach`.
const isNudgeable = (s: SessionState): boolean => s.state !== "stopped" && s.state !== "failed"

const runningFor = (
  companions: readonly SessionState[],
  role: CompanionRole,
): SessionState | undefined =>
  companions.find((s) => companionRoleFromIntent(s.intent) === role && isNudgeable(s))

const sendKeys = async (short: string, keys: string): Promise<boolean> => {
  // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
  const client = api as any
  const res = await client.sessions[":id"].send.$post({ param: { id: short }, json: { keys } })
  return Boolean(res.ok)
}

type ActionResult = {
  readonly kind: "nudged" | "nudge_failed" | "spawned"
  readonly short: string | null
}

// Nudge the companion already running this role, or spawn a fresh one. Kept
// outside the component so the button handler stays a thin state adapter.
const runCompanionAction = async (input: {
  readonly companions: readonly SessionState[]
  readonly role: CompanionRole
  readonly note: string
  readonly brainstorm: Brainstorm
  readonly project: Project
}): Promise<ActionResult> => {
  const running = runningFor(input.companions, input.role)
  if (running) {
    const ok = await sendKeys(
      running.short,
      `${companionNudge(input.brainstorm.file, input.note)}\r`,
    )
    return { kind: ok ? "nudged" : "nudge_failed", short: running.short }
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
    nudged: `nudged ${role}`,
    nudge_failed: `nudge failed (${role})`,
    spawned: `spawned ${role}`,
  })[kind]

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
    {COMPANION_ROLES.map((spec) => {
      const running = runningFor(companions, spec.role)
      return (
        <button
          key={spec.role}
          type="button"
          data-testid={`brainstorm-role-${spec.role}`}
          onClick={() => onAct(spec.role)}
          disabled={busyRole !== null}
          title={running ? `${spec.title} — nudge the running companion` : spec.title}
          className="btn btn-xs justify-start gap-1.5 normal-case bg-base-100 border-base-300 hover:border-primary/40"
        >
          {running ? (
            <span className={`h-1.5 w-1.5 rounded-full ${stateColor(running.state).dot}`} />
          ) : null}
          <span className="truncate">{busyRole === spec.role ? "…" : spec.label}</span>
        </button>
      )
    })}
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
 * The "AI by my side" panel for one brainstorm: role buttons spawn a focused
 * companion session (or nudge the one already running that role), a chip per
 * companion selects whose terminal is shown, and the embedded terminal is the
 * chat with the selected companion. Companions are recovered purely from the
 * sessions list via the intent marker — no extra store.
 */
export const BrainstormCompanion = ({ project, brainstorm }: Props) => {
  const qc = useQueryClient()
  const sessionsQ = useSessions()
  const companions = (sessionsQ.data ?? []).filter(
    (s) => s.cwd === project.path && isCompanionIntent(s.intent, brainstorm.id),
  )

  const [selectedShort, setSelectedShort] = useState<string | null>(null)
  const [note, setNote] = useState("")
  const [busyRole, setBusyRole] = useState<CompanionRole | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const selected = selectedCompanion(companions, selectedShort)

  const flashStatus = (msg: string) => {
    setStatus(msg)
    setTimeout(() => setStatus(null), 4_000)
  }

  const afterAction = (result: ActionResult, role: CompanionRole) => {
    if (result.kind === "spawned") qc.invalidateQueries({ queryKey: ["sessions"] })
    if (result.short !== null) setSelectedShort(result.short)
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
    // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
    const client = api as any
    client.sessions[":id"].stop
      .$post({ param: { id: short } })
      .then(() => qc.invalidateQueries({ queryKey: ["sessions"] }))
      .catch(() => flashStatus("stop failed"))
  }

  return (
    <aside
      data-testid="brainstorm-companion"
      className="flex w-[24rem] shrink-0 flex-col gap-2 rounded-xl border border-base-300 bg-base-200/40 p-2 min-h-0"
    >
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
