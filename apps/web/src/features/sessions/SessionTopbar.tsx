import { Link } from "@tanstack/react-router"
import { stateColor } from "../../lib/format"
import { TAB_ICONS, tabButtonClass, tabDockNavClass } from "../../lib/tabDock"
import type { SessionState } from "../../lib/types"
import { sessionIdentity } from "./sessionIdentity"
import { SESSION_TAB_DOCK, type SessionTab } from "./sessionTabs"
import { SidebarReopenButton } from "./sidebarRail"
import type { SessionActions } from "./useSessionActions"

// The session identity cluster, shaped like ProjectIdentity on the project page:
// one h1 carrying the name plus inline chips, with the absolute cwd left as the
// hover title rather than spending inline width on a row that now also holds the
// section dock.
const IDENTITY_H1 = "text-sm font-semibold flex items-center gap-1.5 min-w-0 shrink"
const CHIP = "shrink-0 inline-flex items-center rounded bg-base-200 text-base-content/80"

// Until the session query resolves, the id from the URL is all we know.
const PendingIdentity = ({ fallbackId }: { readonly fallbackId: string }) => (
  <h1 className={IDENTITY_H1} title={fallbackId}>
    <span className="truncate">{fallbackId}</span>
  </h1>
)

const ResolvedIdentity = ({ session }: { readonly session: SessionState }) => {
  const tone = stateColor(session.state)
  const { label, chip } = sessionIdentity(session)
  return (
    <h1 className={IDENTITY_H1} title={session.cwd}>
      <span className="truncate">{label}</span>
      <span
        className={`shrink-0 badge badge-sm uppercase tracking-wide font-semibold ${tone.bg} ${tone.text}`}
      >
        {tone.label}
      </span>
      {chip ? (
        <span data-testid="session-short" className={`${CHIP} font-mono text-[10px] px-1.5 py-0.5`}>
          {chip}
        </span>
      ) : null}
    </h1>
  )
}

const SessionIdentity = ({
  session,
  fallbackId,
}: {
  readonly session: SessionState | null | undefined
  readonly fallbackId: string
}) =>
  session ? <ResolvedIdentity session={session} /> : <PendingIdentity fallbackId={fallbackId} />

// The drill-in's section dock — the same shared classes the root dashboard and
// the project page use, so all three navs read as one system.
const SessionTabDock = ({
  tab,
  onSelect,
}: {
  readonly tab: SessionTab
  readonly onSelect: (next: SessionTab) => void
}) => (
  <nav
    data-testid="session-tabs"
    role="tablist"
    aria-label="Session sections"
    className={`${tabDockNavClass} flex-1 min-w-0`}
  >
    {SESSION_TAB_DOCK.map((t) => (
      <button
        key={t.key}
        type="button"
        role="tab"
        aria-selected={tab === t.key}
        data-testid={`tab-${t.key}`}
        data-active={tab === t.key}
        onClick={() => onSelect(t.key)}
        className={tabButtonClass(tab === t.key)}
      >
        {TAB_ICONS[t.key]}
        {t.label}
      </button>
    ))}
  </nav>
)

// A button's label plus the spinner it shows while its request is in flight.
// Folding both into one component keeps each action button branch-free.
const BusyLabel = ({
  busy,
  label,
  busyLabel,
}: {
  readonly busy: boolean
  readonly label: string
  readonly busyLabel: string
}) => (
  <>
    {busy ? <span className="loading loading-spinner loading-xs" /> : null}
    {busy ? busyLabel : label}
  </>
)

// Kill / Delete keep their tinted look via semantic warning / error tokens, so
// one class adapts across the pidlight / piddark themes — no per-theme variant.
const KILL_BTN =
  "btn btn-xs normal-case border-warning/40 bg-warning/15 text-warning hover:bg-warning/25 disabled:opacity-30 disabled:bg-transparent disabled:border-base-300 disabled:text-base-content/50"
const DELETE_BTN_ARMED = "border-error bg-error text-error-content hover:opacity-90"
const DELETE_BTN_IDLE = "border-error/40 bg-error/15 text-error hover:bg-error/25"

const SessionActionButtons = ({ actions }: { readonly actions: SessionActions }) => {
  const { flags, on } = actions
  return (
    <div className="flex items-center gap-1 shrink-0">
      <button type="button" onClick={on.copy} className="btn btn-xs btn-ghost normal-case">
        <BusyLabel busy={flags.copied} label="Open in CLI ↗" busyLabel="Copied" />
      </button>
      <button
        type="button"
        data-testid="peek"
        onClick={on.peek}
        disabled={flags.peeking}
        className="btn btn-xs btn-ghost normal-case disabled:opacity-40"
        title="Trigger a fresh Haiku peek (costs one call against your quota)"
      >
        <BusyLabel busy={flags.peeking} label="Peek" busyLabel="Peeking…" />
      </button>
      <button
        type="button"
        data-testid="stop"
        onClick={on.stop}
        disabled={!flags.canStop}
        className={KILL_BTN}
        title="claude stop — process exits, registry keeps the entry (claude respawn to recover)"
      >
        <BusyLabel busy={flags.stopping} label="Kill" busyLabel="Stopping…" />
      </button>
      <button
        type="button"
        data-testid="delete"
        onClick={on.delete}
        onBlur={on.cancelConfirm}
        disabled={flags.deleting}
        className={`btn btn-xs normal-case disabled:opacity-30 ${
          flags.confirmDelete ? DELETE_BTN_ARMED : DELETE_BTN_IDLE
        }`}
        title="claude rm — remove session entirely; worktree cleaned if no uncommitted changes"
      >
        <BusyLabel
          busy={flags.deleting}
          label={flags.confirmDelete ? "Confirm?" : "Delete"}
          busyLabel="Deleting…"
        />
      </button>
    </div>
  )
}

// ONE row for identity, the section dock and the actions — the same shape the
// project dashboard's topbar uses.
export const SessionTopbar = ({
  session,
  fallbackId,
  tab,
  onSelectTab,
  actions,
}: {
  readonly session: SessionState | null | undefined
  readonly fallbackId: string
  readonly tab: SessionTab
  readonly onSelectTab: (next: SessionTab) => void
  readonly actions: SessionActions
}) => (
  <div data-testid="session-topbar" className="flex items-center gap-2">
    <SidebarReopenButton />

    <Link
      to="/"
      className="text-[11px] text-base-content/60 hover:underline shrink-0"
      title="All sessions"
    >
      ←
    </Link>

    <SessionIdentity session={session} fallbackId={fallbackId} />

    <SessionTabDock tab={tab} onSelect={onSelectTab} />

    <SessionActionButtons actions={actions} />
  </div>
)
