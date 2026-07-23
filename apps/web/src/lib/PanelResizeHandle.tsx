import type { PointerEventHandler } from "react"

type Props = {
  readonly testid: string
  readonly ariaLabel: string
  readonly onResizeStart: PointerEventHandler<HTMLButtonElement>
  readonly onReset: () => void
  // Positive delta widens the right-docked panel (ArrowLeft), negative
  // narrows it (ArrowRight) — matches the drag direction of the left edge.
  readonly onNudge: (delta: number) => void
}

const NUDGE_PX = 16

/**
 * The draggable/keyboard-operable splitter on the left edge of a right-docked
 * side panel. Pure presentation — the owning panel holds the width state via
 * usePersistedWidth/usePanelDrag (see lib/panelResize.ts).
 */
export const PanelResizeHandle = ({
  testid,
  ariaLabel,
  onResizeStart,
  onReset,
  onNudge,
}: Props) => (
  <button
    type="button"
    data-testid={testid}
    aria-label={ariaLabel}
    title="Drag or use ←/→ to resize · double-click to reset"
    onPointerDown={onResizeStart}
    onDoubleClick={onReset}
    onKeyDown={(e) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault()
        onNudge(NUDGE_PX)
      } else if (e.key === "ArrowRight") {
        e.preventDefault()
        onNudge(-NUDGE_PX)
      }
    }}
    className="absolute -left-2 top-0 z-10 h-full w-2 cursor-col-resize touch-none rounded-full p-0 hover:bg-primary/40 focus-visible:bg-primary/40"
  />
)
