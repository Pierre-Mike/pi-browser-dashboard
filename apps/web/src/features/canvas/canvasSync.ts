import type { CanvasSnapshot } from "./canvas.types"

// Stable comparison body: drops `updatedAt` because the server stamps that
// field on every publish, so the same drawing keeps the same comparison key
// across round-trips. Two structurally-equal canvases serialize to the same
// string regardless of when they were last touched.
const stableBody = (snap: CanvasSnapshot): string =>
  JSON.stringify({ nodes: snap.nodes, edges: snap.edges, viewport: snap.viewport })

/**
 * Decide whether the locally-tracked canvas state diverges from the last value
 * we've synchronized with the server (either sent or received). The hook calls
 * this on every debounce tick to avoid chatting over the wire when nothing
 * actually changed.
 *
 * If `lastWire` is null we haven't seen a snapshot yet — sending now would
 * stomp on whatever the server already has. The hook waits for the first
 * inbound frame before letting upstream traffic flow.
 */
export const canvasShouldSend = (
  latest: CanvasSnapshot,
  lastWire: CanvasSnapshot | null,
): boolean => {
  if (lastWire === null) return false
  return stableBody(latest) !== stableBody(lastWire)
}

export const canvasStableKey = (snap: CanvasSnapshot): string => stableBody(snap)
