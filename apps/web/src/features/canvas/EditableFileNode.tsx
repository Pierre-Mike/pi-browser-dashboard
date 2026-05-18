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

// JSON Canvas spec exposes a "file" node — a card referencing a vault file
// path. We mirror the wire shape: `data.file` holds the path. Rendering is
// deliberately read-only on the file contents (no preview parser here) so the
// node stays a stable reference; double-click to edit the path.

type FileNode = Node<{ file?: string; color?: string; locked?: boolean }, "file">

const HANDLE_STYLE = { width: 8, height: 8 }

const basename = (p: string): string => {
  const cleaned = p.replace(/\\/g, "/")
  const i = cleaned.lastIndexOf("/")
  return i >= 0 ? cleaned.slice(i + 1) : cleaned
}

export const EditableFileNode = ({ id, data, selected }: NodeProps<FileNode>) => {
  const initial = typeof data?.file === "string" ? data.file : ""
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
          n.id === id ? { ...n, data: { ...(n.data as Record<string, unknown>), file: next } } : n,
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
      data-testid="canvas-node-file"
      data-node-id={id}
      onDoubleClick={() => setEditing(true)}
      className={`group rounded-md border bg-white dark:bg-slate-900 px-3 py-2 text-xs shadow-sm w-full h-full min-w-[160px] min-h-[48px] text-left ${
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
        minHeight={48}
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
          data-testid="canvas-file-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit(draft)}
          onKeyDown={onKeyDown}
          placeholder="path/to/file"
          className="w-full bg-transparent outline-none"
        />
      ) : initial ? (
        <>
          <span
            data-testid="canvas-file-name"
            className="block font-medium text-slate-800 dark:text-slate-100 truncate"
          >
            {basename(initial)}
          </span>
          <span className="block text-[10px] text-slate-500 dark:text-slate-400 truncate">
            {initial}
          </span>
        </>
      ) : (
        <span
          data-testid="canvas-file-placeholder"
          className="text-slate-500 dark:text-slate-400 italic"
        >
          (file)
        </span>
      )}
    </div>
  )
}
