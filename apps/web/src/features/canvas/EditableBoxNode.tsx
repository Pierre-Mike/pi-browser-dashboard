import { Handle, type Node, type NodeProps, Position, useReactFlow } from "@xyflow/react"
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react"

// React Flow gives us a node with `data.label` plus a `selected` flag. We
// render a rounded card; double-click swaps in an input so the user can edit
// the label in place. Edits commit on Enter or blur, escape reverts.

type BoxNode = Node<{ label?: string }, "box">

export const EditableBoxNode = ({ id, data, selected }: NodeProps<BoxNode>) => {
  const initial = typeof data?.label === "string" ? data.label : ""
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(initial)
  const { setNodes } = useReactFlow()
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!editing) setDraft(initial)
  }, [editing, initial])

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const commit = useCallback(
    (next: string) => {
      setNodes((prev) =>
        prev.map((n) =>
          n.id === id ? { ...n, data: { ...(n.data as Record<string, unknown>), label: next } } : n,
        ),
      )
      setEditing(false)
    },
    [id, setNodes],
  )

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault()
      commit(draft)
    } else if (e.key === "Escape") {
      e.preventDefault()
      setDraft(initial)
      setEditing(false)
    }
    // Stop bubbling so React Flow's delete-key handler doesn't eat a Backspace
    // while the user is editing text.
    e.stopPropagation()
  }

  return (
    <div
      data-testid="canvas-node-box"
      data-node-id={id}
      onDoubleClick={() => setEditing(true)}
      className={`group rounded-md border bg-white dark:bg-slate-900 px-3 py-2 text-xs shadow-sm min-w-[120px] text-center ${
        selected ? "border-sky-500 ring-1 ring-sky-400" : "border-slate-300 dark:border-slate-700"
      }`}
    >
      <Handle type="target" position={Position.Top} />
      {editing ? (
        <input
          ref={inputRef}
          data-testid="canvas-node-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit(draft)}
          onKeyDown={onKeyDown}
          className="w-full bg-transparent outline-none text-center"
        />
      ) : (
        <span
          data-testid="canvas-node-label"
          className="text-slate-800 dark:text-slate-100 whitespace-pre-wrap break-words"
        >
          {initial || "Untitled"}
        </span>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
