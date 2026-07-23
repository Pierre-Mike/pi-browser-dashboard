import { Excalidraw, restoreElements } from "@excalidraw/excalidraw"
import "@excalidraw/excalidraw/index.css"
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types"
import { useEffect, useState } from "react"
import type { ExcalidrawSyncStatus } from "./useExcalidrawSync"
import { useExcalidrawSync } from "./useExcalidrawSync"

type Props = {
  readonly projectId: string
  readonly slug: string
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
    className={`absolute right-2 top-2 z-10 rounded-full px-2 py-0.5 text-[10px] font-medium ${statusTone(status)}`}
  >
    {STATUS_LABEL[status]}
  </span>
)

// Excalidraw's restore utils exist to sanitize untrusted imported scenes —
// exactly what an agent-written file is. The cast crosses from wire JSON into
// Excalidraw's element type; restoreElements fills in whatever is missing.
const sanitizeElements = (elements: readonly unknown[]) =>
  restoreElements(elements as Parameters<typeof restoreElements>[0], null)

/**
 * The V2 brainstorm editor: a full local Excalidraw bound to one
 * <project>/.pid/brainstorms/<slug>.excalidraw document. The daemon doc room
 * pushes every external write (agent, other tab) down the socket, and local
 * strokes flow back up debounced — same live-sync contract as the V1 canvas.
 */
export const ExcalidrawBoard = ({ projectId, slug }: Props) => {
  const { status, remote, sendElements } = useExcalidrawSync({ projectId, slug })
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null)

  useEffect(() => {
    if (api === null || remote === null) return
    api.updateScene({ elements: sanitizeElements(remote.doc.elements) })
  }, [api, remote])

  return (
    <div
      data-testid="excalidraw-board"
      className="relative h-full w-full overflow-hidden rounded-xl border border-base-300"
    >
      <StatusBadge status={status} />
      <Excalidraw
        excalidrawAPI={setApi}
        onChange={(elements) => sendElements(elements)}
        UIOptions={{ canvasActions: { loadScene: false } }}
      />
    </div>
  )
}
