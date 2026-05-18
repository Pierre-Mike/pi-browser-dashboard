import {
  Handle,
  type Node,
  type NodeProps,
  NodeResizer,
  Position,
  useReactFlow,
} from "@xyflow/react"
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react"
import { colorFor } from "./canvasObsidian"

// Obsidian Canvas exposes a "link" node type — a card with a URL. We keep the
// rendering simple: the URL is shown as a clickable host pill plus the full
// URL underneath. Double-click to edit the URL; ctrl-click the host to open in
// a new tab. We deliberately don't embed an iframe (CSP/sandbox surface area)
// — users open the link to follow it.

type LinkNode = Node<{ url?: string; color?: string }, "link">

const HANDLE_STYLE = { width: 8, height: 8 }

const hostOf = (raw: string): string => {
  try {
    return new URL(raw).host
  } catch {
    return raw
  }
}

const isSafeUrl = (raw: string): boolean => /^https?:\/\//i.test(raw.trim())

export const EditableLinkNode = ({ id, data, selected }: NodeProps<LinkNode>) => {
  const initial = typeof data?.url === "string" ? data.url : ""
  const colorKey = typeof data?.color === "string" ? data.color : ""
  const palette = colorFor(colorKey)
  const [editing, setEditing] = useState(initial.length === 0)
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
          n.id === id ? { ...n, data: { ...(n.data as Record<string, unknown>), url: next } } : n,
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
      data-testid="canvas-node-link"
      data-node-id={id}
      onDoubleClick={() => setEditing(true)}
      className={`group rounded-md border bg-white dark:bg-slate-900 px-3 py-2 text-xs shadow-sm w-full h-full text-left ${
        palette.stroke
          ? ""
          : selected
            ? "border-sky-500 ring-1 ring-sky-400"
            : "border-slate-300 dark:border-slate-700"
      }`}
      style={
        palette.stroke
          ? {
              borderColor: palette.stroke,
              boxShadow: selected ? `0 0 0 1px ${palette.stroke}` : undefined,
              backgroundColor: palette.fill || undefined,
            }
          : undefined
      }
    >
      <NodeResizer
        isVisible={selected}
        minWidth={160}
        minHeight={64}
        lineClassName="border-sky-400"
        handleClassName="bg-sky-500 border-white"
      />
      <Handle id="top" type="target" position={Position.Top} style={HANDLE_STYLE} />
      <Handle id="top" type="source" position={Position.Top} style={HANDLE_STYLE} />
      <Handle id="right" type="target" position={Position.Right} style={HANDLE_STYLE} />
      <Handle id="right" type="source" position={Position.Right} style={HANDLE_STYLE} />
      <Handle id="bottom" type="target" position={Position.Bottom} style={HANDLE_STYLE} />
      <Handle id="bottom" type="source" position={Position.Bottom} style={HANDLE_STYLE} />
      <Handle id="left" type="target" position={Position.Left} style={HANDLE_STYLE} />
      <Handle id="left" type="source" position={Position.Left} style={HANDLE_STYLE} />
      {editing ? (
        <input
          ref={inputRef}
          data-testid="canvas-link-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit(draft)}
          onKeyDown={onKeyDown}
          placeholder="https://example.com"
          className="w-full bg-transparent outline-none"
        />
      ) : initial && isSafeUrl(initial) ? (
        <a
          data-testid="canvas-link-href"
          href={initial}
          target="_blank"
          rel="noreferrer"
          className="block text-sky-700 dark:text-sky-300 underline truncate"
          onClick={(e) => e.stopPropagation()}
        >
          {hostOf(initial)}
        </a>
      ) : (
        <span
          data-testid="canvas-link-placeholder"
          className="text-slate-500 dark:text-slate-400 italic"
        >
          (link)
        </span>
      )}
      {!editing && initial ? (
        <div className="mt-1 text-[10px] text-slate-500 dark:text-slate-400 truncate">
          {initial}
        </div>
      ) : null}
    </div>
  )
}
