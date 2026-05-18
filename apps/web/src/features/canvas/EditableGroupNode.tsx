import { type Node, type NodeProps, NodeResizer, useReactFlow } from "@xyflow/react"
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react"

type GroupNode = Node<{ label?: string }, "group">

// A group is a transparent rectangle with a dashed border. Its label sits at
// the top so it doesn't fight with child boxes for clicks. Double-click the
// label strip to rename. NodeResizer is mounted only while selected so users
// can drag the bottom-right corner to resize the cluster.

export const EditableGroupNode = ({ id, data, selected }: NodeProps<GroupNode>) => {
  const initial = typeof data?.label === "string" ? data.label : "Group"
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
    e.stopPropagation()
  }

  return (
    <div
      data-testid="canvas-node-group"
      data-node-id={id}
      className={`relative w-full h-full rounded-lg border-2 border-dashed ${
        selected
          ? "border-sky-500 bg-sky-50/30 dark:bg-sky-950/20"
          : "border-slate-400 dark:border-slate-600 bg-slate-100/30 dark:bg-slate-800/20"
      }`}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={120}
        minHeight={80}
        lineClassName="border-sky-400"
        handleClassName="bg-sky-500 border-white"
      />
      <div
        onDoubleClick={(e) => {
          e.stopPropagation()
          setEditing(true)
        }}
        className="absolute top-0 left-0 right-0 px-2 py-1 text-[10px] uppercase tracking-wider text-slate-600 dark:text-slate-300 cursor-text select-none"
      >
        {editing ? (
          <input
            ref={inputRef}
            data-testid="canvas-group-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commit(draft)}
            onKeyDown={onKeyDown}
            className="w-full bg-transparent outline-none uppercase tracking-wider"
          />
        ) : (
          <span data-testid="canvas-group-label">{initial}</span>
        )}
      </div>
    </div>
  )
}
