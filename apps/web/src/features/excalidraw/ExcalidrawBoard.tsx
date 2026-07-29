import { Excalidraw, restoreElements } from "@excalidraw/excalidraw"
import "@excalidraw/excalidraw/index.css"
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types"
import { useEffect, useState } from "react"
import type { ExcalidrawSyncStatus } from "./useExcalidrawSync"
import { useExcalidrawSync } from "./useExcalidrawSync"

type Props = {
  readonly short: string
  readonly path: string
  readonly label: string
}

const STATUS_LABEL: Record<ExcalidrawSyncStatus, string> = {
  connecting: "connecting…",
  open: "live",
  closed: "reconnecting…",
  error: "connection error",
}

const statusTone = (status: ExcalidrawSyncStatus): string =>
  status === "open" ? "bg-success/15 text-success" : "bg-warning/15 text-warning"

const StatusBadge = ({ status }: { readonly status: ExcalidrawSyncStatus }) => (
  <span
    data-testid="excalidraw-status"
    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${statusTone(status)}`}
  >
    {STATUS_LABEL[status]}
  </span>
)

// A slim strip above the editor rather than a floating overlay: Excalidraw owns
// all four corners of its canvas (menu, Library, zoom, help), so an absolutely
// positioned badge covered its Library button.
const BoardHeader = ({
  label,
  status,
}: {
  readonly label: string
  readonly status: ExcalidrawSyncStatus
}) => (
  <div className="flex shrink-0 items-center gap-2 border-b border-base-300 bg-base-200/40 px-2 py-1">
    <span className="truncate text-xs font-semibold text-base-content/80" title={label}>
      {label}
    </span>
    <span className="ml-auto flex items-center">
      <StatusBadge status={status} />
    </span>
  </div>
)

// Excalidraw's restore utils exist to sanitize untrusted imported scenes —
// exactly what an agent-written file is. The cast crosses from wire JSON into
// Excalidraw's element type; restoreElements fills in whatever is missing.
const sanitizeElements = (elements: readonly unknown[]) =>
  restoreElements(elements as Parameters<typeof restoreElements>[0], null)

/**
 * The Excalidraw brainstorm editor: a full local Excalidraw bound to one
 * `*.excalidraw` file in the session's worktree. The daemon doc room pushes
 * every external write (the session's agent, another tab) down the socket, and
 * local strokes flow back up debounced — same live-sync contract as the canvas.
 */
export const ExcalidrawBoard = ({ short, path, label }: Props) => {
  const { status, remote, sendElements } = useExcalidrawSync({ short, path })
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null)

  useEffect(() => {
    if (api === null || remote === null) return
    api.updateScene({ elements: sanitizeElements(remote.doc.elements) })
  }, [api, remote])

  // Header strip + editor as a flex column so Excalidraw's host has a definite
  // height to measure, and `min-w-0` so it tracks the column it was given
  // instead of its own (much wider) intrinsic size.
  return (
    <div
      data-testid="excalidraw-board"
      className="flex h-full w-full min-w-0 flex-col overflow-hidden rounded-box border border-base-300"
    >
      <BoardHeader label={label} status={status} />
      <div className="relative min-h-0 min-w-0 flex-1">
        <Excalidraw
          excalidrawAPI={setApi}
          onChange={(elements) => sendElements(elements)}
          UIOptions={{ canvasActions: { loadScene: false } }}
        />
      </div>
    </div>
  )
}
