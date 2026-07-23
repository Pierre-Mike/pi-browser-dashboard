import { BaseEdge, EdgeLabelRenderer, type EdgeProps, getBezierPath } from "@xyflow/react"
import { createContext, useContext, useEffect, useRef, useState } from "react"

// Obsidian parity for naming arrows: double-click a connection line and a
// focused editor opens right at the line's midpoint. The canvas owns which
// edge is being edited (one at a time) and how a commit lands in edge state;
// the edge component only renders the chip/editor at its own midpoint.

export type EdgeLabelEditApi = {
  readonly editingEdgeId: string | null
  readonly startEditing: (id: string) => void
  readonly commitLabel: (id: string, label: string) => void
  readonly cancelEditing: () => void
  readonly selectEdge: (id: string) => void
}

const noop = (): void => {}

export const EdgeLabelEditContext = createContext<EdgeLabelEditApi>({
  editingEdgeId: null,
  startEditing: noop,
  commitLabel: noop,
  cancelEditing: noop,
  selectEdge: noop,
})

const EdgeLabelInput = ({ id, initial }: { id: string; initial: string }) => {
  const { commitLabel, cancelEditing } = useContext(EdgeLabelEditContext)
  const [draft, setDraft] = useState(initial)
  const inputRef = useRef<HTMLInputElement | null>(null)
  // Enter/Escape close the editor and unmount the input, which then fires
  // blur; without this guard a blur-commit would resurrect a canceled draft.
  const doneRef = useRef(false)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const finish = (commit: boolean) => {
    if (doneRef.current) return
    doneRef.current = true
    if (commit) commitLabel(id, draft)
    else cancelEditing()
  }

  return (
    <input
      ref={inputRef}
      data-testid="canvas-edge-label-inline"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault()
          finish(true)
        } else if (e.key === "Escape") {
          e.preventDefault()
          finish(false)
        }
        // Keep Backspace/Delete out of React Flow's delete handler and our
        // global undo/redo shortcuts while the user is typing.
        e.stopPropagation()
      }}
      placeholder="label"
      className="border border-primary rounded bg-base-100 px-1.5 py-0.5 text-[10px] text-base-content shadow-sm outline-none w-28 text-center"
    />
  )
}

// The static chip showing an edge's name; double-click re-opens the editor.
// A colored edge tints its chip to match the stroke.
const EdgeLabelChip = (args: { id: string; label: string; stroke: string | undefined }) => {
  const { startEditing, selectEdge } = useContext(EdgeLabelEditContext)
  return (
    <button
      type="button"
      data-testid="canvas-edge-label-text"
      onClick={() => selectEdge(args.id)}
      onDoubleClick={() => startEditing(args.id)}
      className="rounded border border-base-300 bg-base-100 px-1.5 py-0.5 text-[10px] text-base-content shadow-sm cursor-text"
      style={args.stroke ? { color: args.stroke, borderColor: args.stroke } : undefined}
      title="Double-click to rename"
    >
      {args.label}
    </button>
  )
}

// Floating overlay at the edge midpoint: nothing for an unnamed idle edge,
// the editor while editing, the chip otherwise. Lives in React Flow's HTML
// label layer, so pointer events work.
const EdgeLabelOverlay = (args: {
  id: string
  label: string
  editing: boolean
  x: number
  y: number
  stroke: string | undefined
}) => {
  if (!args.editing && !args.label) return null
  return (
    <EdgeLabelRenderer>
      <div
        className="nodrag nopan"
        style={{
          position: "absolute",
          transform: `translate(-50%, -50%) translate(${args.x}px, ${args.y}px)`,
          pointerEvents: "all",
        }}
      >
        {args.editing ? (
          <EdgeLabelInput id={args.id} initial={args.label} />
        ) : (
          <EdgeLabelChip id={args.id} label={args.label} stroke={args.stroke} />
        )}
      </div>
    </EdgeLabelRenderer>
  )
}

const labelText = (label: unknown): string => (typeof label === "string" ? label : "")

const strokeOf = (style: unknown): string | undefined =>
  (style as { stroke?: string } | undefined)?.stroke

/**
 * Default edge renderer: the plain line plus a floating midpoint label.
 */
export const LabeledEdge = (props: EdgeProps) => {
  const { editingEdgeId } = useContext(EdgeLabelEditContext)
  const [path, labelX, labelY] = getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
  })

  return (
    <>
      <BaseEdge
        path={path}
        markerStart={props.markerStart}
        markerEnd={props.markerEnd}
        style={props.style}
      />
      <EdgeLabelOverlay
        id={props.id}
        label={labelText(props.label)}
        editing={editingEdgeId === props.id}
        x={labelX}
        y={labelY}
        stroke={strokeOf(props.style)}
      />
    </>
  )
}
