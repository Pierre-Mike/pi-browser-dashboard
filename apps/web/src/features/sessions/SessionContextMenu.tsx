import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { api } from "../../lib/api"

// Approximate rendered size, used to clamp the menu inside the viewport
// before first paint (see clampMenuPosition).
export const MENU_WIDTH = 176
export const MENU_HEIGHT = 44

type Props = {
  short: string
  x: number
  y: number
  onClose: () => void
}

// Right-click menu for a sidebar session row. Delete mirrors SessionCard's
// two-stage confirm, just inline in the menu item.
export const SessionContextMenu = ({ short, x, y, onClose }: Props) => {
  const qc = useQueryClient()
  const ref = useRef<HTMLDivElement | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener("keydown", onKey)
    window.addEventListener("mousedown", onPointerDown)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("mousedown", onPointerDown)
    }
  }, [onClose])

  const onDelete = async () => {
    if (deleting) return
    if (!confirm) {
      setConfirm(true)
      return
    }
    setDeleting(true)
    try {
      // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
      const client = api as any
      const res = await client.sessions[":id"].rm.$post({ param: { id: short } })
      if (!res.ok) {
        console.error("delete failed", await res.text())
      }
      qc.invalidateQueries({ queryKey: ["sessions"] })
    } catch (err) {
      console.error("delete failed", err)
    } finally {
      setDeleting(false)
      onClose()
    }
  }

  return createPortal(
    <div
      ref={ref}
      role="menu"
      data-testid="session-context-menu"
      data-short={short}
      style={{ left: x, top: y, width: MENU_WIDTH }}
      className="fixed z-50 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg py-1 text-xs"
    >
      <button
        type="button"
        role="menuitem"
        data-testid="session-context-delete"
        onClick={onDelete}
        disabled={deleting}
        className={`w-full text-left px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed ${
          confirm
            ? "bg-rose-500 text-white hover:bg-rose-600 font-medium"
            : "text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40"
        }`}
        title="claude rm — remove session entirely; worktree cleaned if no uncommitted changes"
      >
        {deleting ? "Deleting…" : confirm ? "Confirm delete?" : "Delete session"}
      </button>
    </div>,
    document.body,
  )
}
