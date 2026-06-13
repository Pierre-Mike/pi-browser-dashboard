import { Link } from "@tanstack/react-router"
import { useState } from "react"
import { stateColor, stateTitle } from "../../lib/format"
import type { Project, SessionState } from "../../lib/types"
import { clampMenuPosition } from "./contextMenu"
import { MENU_HEIGHT, MENU_WIDTH } from "./SessionContextMenu"
import { SessionReplyModal } from "./SessionReplyModal"
import type { SidebarBucket as Bucket } from "./sidebarUtil"
import {
  dropTargetId,
  isDraggingSelf,
  isOverTarget,
  pinnedProjectId,
  sessionLabel,
  sessionMoreLabel,
} from "./sidebarUtil"

// One sidebar project/orphan row plus its (collapsible) session list. Split out
// of Sidebar so the bucket markup — drag-to-reorder, pin, spawn, sessions —
// stays small enough to read; each sub-component owns one concern.

export type SessionMenu = { short: string; x: number; y: number }

export type BucketDrag = {
  readonly draggingId: string | null
  readonly overId: string | null
  readonly onStart: (projectId: string) => void
  readonly onOver: (projectId: string) => void
  readonly onLeave: (projectId: string) => void
  readonly onDrop: (projectId: string) => void
  readonly onEnd: () => void
}

const rowClass = ({
  active,
  over,
  dragging,
}: {
  active: boolean
  over: boolean
  dragging: boolean
}): string =>
  [
    "group flex items-center gap-1.5 px-1.5 py-1 rounded",
    over ? "shadow-[inset_0_2px_0_0] shadow-amber-500" : "",
    active
      ? "bg-sky-100 dark:bg-sky-900/50 shadow-[inset_2px_0_0_0] shadow-sky-500"
      : "hover:bg-slate-50 dark:hover:bg-slate-900/60",
    dragging ? "opacity-40" : "",
  ].join(" ")

const dragHandlers = (target: string | null, drag: BucketDrag) => ({
  onDragOver: (e: React.DragEvent) => {
    if (!target) return
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
    drag.onOver(target)
  },
  onDragLeave: () => {
    if (target) drag.onLeave(target)
  },
  onDrop: (e: React.DragEvent) => {
    if (!target) return
    e.preventDefault()
    drag.onDrop(target)
  },
})

const CollapseToggle = ({
  bucket,
  collapsed,
  onToggle,
}: {
  bucket: Bucket
  collapsed: boolean
  onToggle: (key: string) => void
}) => {
  const hint = collapsed ? `Show sessions in ${bucket.title}` : `Hide sessions in ${bucket.title}`
  return (
    <button
      type="button"
      onClick={() => onToggle(bucket.key)}
      data-testid="sidebar-collapse-toggle"
      data-bucket-key={bucket.key}
      data-collapsed={String(collapsed)}
      aria-expanded={!collapsed}
      title={hint}
      aria-label={hint}
      className={`shrink-0 inline-flex items-center justify-center w-4 h-4 rounded text-[9px] leading-none text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-transform duration-200 ${
        collapsed ? "-rotate-90" : ""
      }`}
    >
      ▼
    </button>
  )
}

const DragHandle = ({
  project,
  title,
  drag,
}: {
  project: Project
  title: string
  drag: BucketDrag
}) => (
  <button
    type="button"
    draggable
    onDragStart={(e) => {
      e.dataTransfer.effectAllowed = "move"
      // Some browsers require data to be set for the drag to fire.
      e.dataTransfer.setData("text/plain", project.id)
      drag.onStart(project.id)
    }}
    onDragEnd={drag.onEnd}
    data-testid="sidebar-pin-drag-handle"
    data-project-id={project.id}
    title={`Drag to reorder ${title}`}
    aria-label={`Drag to reorder ${title}`}
    className="shrink-0 inline-flex items-center justify-center w-3 h-4 cursor-grab active:cursor-grabbing text-[10px] leading-none text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-400 opacity-0 group-hover:opacity-100 focus:opacity-100"
  >
    ⠿
  </button>
)

const ProjectTitle = ({
  project,
  title,
  pinned,
  active,
}: {
  project: Project
  title: string
  pinned: boolean
  active: boolean
}) => (
  <Link
    to="/projects/$id"
    params={{ id: project.id }}
    data-testid="sidebar-project-link"
    data-project-id={project.id}
    data-pinned={String(pinned)}
    data-active={String(active)}
    className={`truncate flex-1 inline-flex items-center gap-1.5 text-[13px] font-semibold ${
      active
        ? "text-sky-900 dark:text-sky-100"
        : "text-slate-800 dark:text-slate-100 hover:text-sky-700 dark:hover:text-sky-300"
    }`}
  >
    {project.isGitRepo ? null : (
      <span
        title="Not a git repository"
        aria-label="Not a git repository"
        className="text-amber-500 text-[11px] leading-none"
      >
        ⚠
      </span>
    )}
    <span className="truncate">{title}</span>
  </Link>
)

const OrphanTitle = ({ title }: { title: string }) => (
  <span className="truncate flex-1 inline-flex items-center gap-1.5 text-[12px] font-medium italic text-slate-500 dark:text-slate-400">
    <span
      title="No matching project"
      aria-label="No matching project"
      className="text-[9px] uppercase tracking-wide px-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-500"
    >
      orphan
    </span>
    <span className="truncate">{title}</span>
  </span>
)

const BucketTitle = ({ bucket, active }: { bucket: Bucket; active: boolean }) =>
  bucket.project ? (
    <ProjectTitle
      project={bucket.project}
      title={bucket.title}
      pinned={bucket.pinned}
      active={active}
    />
  ) : (
    <OrphanTitle title={bucket.title} />
  )

const SessionCount = ({ count }: { count: number }) => (
  <span
    className={`shrink-0 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] tabular-nums font-medium ${
      count > 0
        ? "bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-200"
        : "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500"
    }`}
    aria-label={`${count} sessions`}
  >
    {count}
  </span>
)

const PinButton = ({
  project,
  title,
  pinned,
  onToggle,
}: {
  project: Project
  title: string
  pinned: boolean
  onToggle: (projectId: string) => void
}) => {
  const label = pinned ? `Unpin ${title}` : `Pin ${title} to top`
  const cls = pinned
    ? "text-amber-500 dark:text-amber-400"
    : "text-slate-300 dark:text-slate-600 hover:text-amber-500 dark:hover:text-amber-400 opacity-0 group-hover:opacity-100 focus:opacity-100"
  return (
    <button
      type="button"
      onClick={() => onToggle(project.id)}
      data-testid="sidebar-pin-toggle"
      data-project-id={project.id}
      data-pinned={String(pinned)}
      title={label}
      aria-label={label}
      aria-pressed={pinned}
      className={`shrink-0 inline-flex items-center justify-center w-5 h-5 rounded text-[11px] leading-none ${cls}`}
    >
      {pinned ? "★" : "☆"}
    </button>
  )
}

const SpawnButton = ({
  project,
  title,
  onSpawn,
}: {
  project: Project
  title: string
  onSpawn: (project: Project) => void
}) => (
  <button
    type="button"
    onClick={() => onSpawn(project)}
    data-testid="sidebar-spawn"
    data-project-id={project.id}
    title={`Spawn a new session in ${title}`}
    aria-label={`Spawn a new session in ${title}`}
    className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded text-sm leading-none text-slate-400 hover:text-sky-600 dark:text-slate-500 dark:hover:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-950/40 opacity-60 group-hover:opacity-100 focus:opacity-100"
  >
    +
  </button>
)

// Pin + spawn live together because both need a real project (orphan buckets
// get neither), so the project guard is paid once.
const BucketActions = ({
  bucket,
  onTogglePin,
  onSpawn,
}: {
  bucket: Bucket
  onTogglePin: (projectId: string) => void
  onSpawn: (project: Project) => void
}) => {
  if (!bucket.project) return null
  return (
    <>
      <PinButton
        project={bucket.project}
        title={bucket.title}
        pinned={bucket.pinned}
        onToggle={onTogglePin}
      />
      <SpawnButton project={bucket.project} title={bucket.title} onSpawn={onSpawn} />
    </>
  )
}

const SessionRow = ({
  session,
  active,
  onContextMenu,
}: {
  session: SessionState
  active: boolean
  onContextMenu: (menu: SessionMenu) => void
}) => {
  const tone = stateColor(session.state)
  const [replyOpen, setReplyOpen] = useState(false)
  return (
    <li>
      <button
        type="button"
        onClick={() => setReplyOpen(true)}
        data-testid="sidebar-session"
        data-short={session.short}
        data-active={String(active)}
        onContextMenu={(e) => {
          e.preventDefault()
          onContextMenu({
            short: session.short,
            ...clampMenuPosition({
              x: e.clientX,
              y: e.clientY,
              menuWidth: MENU_WIDTH,
              menuHeight: MENU_HEIGHT,
              viewportWidth: window.innerWidth,
              viewportHeight: window.innerHeight,
            }),
          })
        }}
        // Status reads as colour, not a text badge: the name is tinted by state
        // and a matching dot leads the row. Hover (title) spells the status out.
        // Click opens the quick-reply modal instead of navigating to the
        // full session view.
        className={`relative flex w-full items-center gap-2 pl-2 pr-1.5 py-1 rounded text-left text-[11.5px] leading-tight ${
          active
            ? "bg-sky-100 dark:bg-sky-900/50 text-sky-900 dark:text-sky-100 font-medium shadow-[inset_2px_0_0_0] shadow-sky-500"
            : `${tone.text} hover:bg-slate-50 dark:hover:bg-slate-900/60`
        }`}
        title={stateTitle(session.state, session.detail)}
      >
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${tone.dot}`}
          aria-hidden
        />
        <span className="truncate flex-1">{sessionLabel(session)}</span>
      </button>
      {replyOpen ? (
        <SessionReplyModal open session={session} onClose={() => setReplyOpen(false)} />
      ) : null}
    </li>
  )
}

const SessionList = ({
  bucket,
  collapsed,
  visible,
  hiddenCount,
  activeShort,
  onShowMore,
  onSessionMenu,
}: {
  bucket: Bucket
  collapsed: boolean
  visible: readonly SessionState[]
  hiddenCount: number
  activeShort: string | undefined
  onShowMore: (key: string) => void
  onSessionMenu: (menu: SessionMenu) => void
}) => (
  <div
    data-testid="sidebar-session-list"
    data-bucket-key={bucket.key}
    data-collapsed={String(collapsed)}
    // grid-rows 1fr→0fr is the pure-CSS slide: the inner min-h-0 row shrinks to
    // nothing and back, animated.
    className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${
      collapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
    }`}
  >
    <ul
      className={`min-h-0 overflow-hidden mt-0.5 ml-3.5 pl-2 border-l border-slate-200 dark:border-slate-800 flex flex-col gap-px ${
        collapsed ? "invisible" : ""
      }`}
    >
      {visible.map((s) => (
        <SessionRow
          key={s.short}
          session={s}
          active={s.short === activeShort}
          onContextMenu={onSessionMenu}
        />
      ))}
      {hiddenCount > 0 ? (
        <li>
          <button
            type="button"
            onClick={() => onShowMore(bucket.key)}
            data-testid="sidebar-session-more"
            data-bucket-key={bucket.key}
            data-hidden-count={hiddenCount}
            className="w-full text-left pl-2 pr-1.5 py-1 rounded text-[11px] leading-tight text-slate-400 dark:text-slate-500 hover:text-sky-700 dark:hover:text-sky-300 hover:bg-slate-50 dark:hover:bg-slate-900/60"
          >
            {sessionMoreLabel(hiddenCount)}
          </button>
        </li>
      ) : null}
    </ul>
  </div>
)

const BucketHeader = ({
  bucket,
  active,
  collapsed,
  drag,
  onToggleCollapsed,
  onTogglePin,
  onSpawn,
}: {
  bucket: Bucket
  active: boolean
  collapsed: boolean
  drag: BucketDrag
  onToggleCollapsed: (key: string) => void
  onTogglePin: (projectId: string) => void
  onSpawn: (project: Project) => void
}) => {
  const selfId = bucket.project?.id
  const pinnedId = pinnedProjectId(bucket)
  const target = dropTargetId(pinnedId, drag.draggingId)
  return (
    <div
      data-testid="sidebar-bucket-row"
      data-project-id={selfId}
      data-drop-target={String(target !== null)}
      {...dragHandlers(target, drag)}
      className={rowClass({
        active,
        over: isOverTarget(target, drag.overId),
        dragging: isDraggingSelf(drag.draggingId, selfId),
      })}
      title={bucket.pathHint}
    >
      {pinnedId !== null && bucket.project ? (
        <DragHandle project={bucket.project} title={bucket.title} drag={drag} />
      ) : null}
      <CollapseToggle bucket={bucket} collapsed={collapsed} onToggle={onToggleCollapsed} />
      <BucketTitle bucket={bucket} active={active} />
      <SessionCount count={bucket.sessions.length} />
      <BucketActions bucket={bucket} onTogglePin={onTogglePin} onSpawn={onSpawn} />
    </div>
  )
}

export type SidebarBucketProps = {
  bucket: Bucket
  active: boolean
  collapsed: boolean
  activeShort: string | undefined
  visible: readonly SessionState[]
  hiddenCount: number
  drag: BucketDrag
  onToggleCollapsed: (key: string) => void
  onTogglePin: (projectId: string) => void
  onSpawn: (project: Project) => void
  onShowMore: (key: string) => void
  onSessionMenu: (menu: SessionMenu) => void
}

export const SidebarBucket = (props: SidebarBucketProps) => (
  <div className="px-1.5 py-1.5">
    <BucketHeader
      bucket={props.bucket}
      active={props.active}
      collapsed={props.collapsed}
      drag={props.drag}
      onToggleCollapsed={props.onToggleCollapsed}
      onTogglePin={props.onTogglePin}
      onSpawn={props.onSpawn}
    />
    {props.bucket.sessions.length > 0 ? (
      <SessionList
        bucket={props.bucket}
        collapsed={props.collapsed}
        visible={props.visible}
        hiddenCount={props.hiddenCount}
        activeShort={props.activeShort}
        onShowMore={props.onShowMore}
        onSessionMenu={props.onSessionMenu}
      />
    ) : null}
  </div>
)
