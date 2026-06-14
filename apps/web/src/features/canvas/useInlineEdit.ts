import { useReactFlow } from "@xyflow/react"
import { useCallback, useEffect, useRef, useState } from "react"

// Every editable canvas node (box, link, file, group) shares the same inline
// edit machinery: an `editing` toggle, a `draft` buffer, focus+select on open,
// reset-on-close, and a commit that writes one `data` field back through React
// Flow. This hook is that machinery in one place so the node components only
// own their own markup and key handling.

export type EditField = "label" | "url" | "file"

export type InlineEdit<E extends HTMLInputElement | HTMLTextAreaElement> = {
  editing: boolean
  setEditing: (v: boolean) => void
  draft: string
  setDraft: (v: string) => void
  inputRef: React.MutableRefObject<E | null>
  commit: (next: string) => void
}

export function useInlineEdit<E extends HTMLInputElement | HTMLTextAreaElement>(args: {
  id: string
  field: EditField
  initial: string
  // Open straight into edit mode when the value is empty (box/link/file). The
  // group node leaves this off because it ships with a default "Group" label.
  autoEdit?: boolean
  // First-render draft override (link nodes seed the project-local URL here).
  seedDraft?: string
}): InlineEdit<E> {
  const { id, field, initial, autoEdit = false, seedDraft } = args
  const [editing, setEditing] = useState(autoEdit && initial.length === 0)
  const [draft, setDraft] = useState(seedDraft ?? initial)
  const inputRef = useRef<E | null>(null)
  const { setNodes } = useReactFlow()

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
          n.id === id
            ? { ...n, data: { ...(n.data as Record<string, unknown>), [field]: next } }
            : n,
        ),
      )
      setEditing(false)
    },
    [id, field, setNodes],
  )

  return { editing, setEditing, draft, setDraft, inputRef, commit }
}
