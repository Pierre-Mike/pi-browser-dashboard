import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type { PaletteEntry } from "./palette"
import { PALETTE_INPUT, PALETTE_MODAL_SHELL } from "./paletteModalLayout"

type Props = {
  open: boolean
  entries: ReadonlyArray<PaletteEntry>
  query: string
  onQueryChange: (q: string) => void
  onSelect: (index: number) => void
  onClose: () => void
}

export const PaletteModal = ({ open, entries, query, onQueryChange, onSelect, onClose }: Props) => {
  const inputRef = useRef<HTMLInputElement>(null)
  const [highlighted, setHighlighted] = useState(0)

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [open])

  // biome-ignore lint/correctness/useExhaustiveDependencies: query/open are reactivity triggers, not read
  useEffect(() => {
    setHighlighted(0)
  }, [query, open])

  if (!open) return null
  if (typeof document === "undefined") return null

  const clamp = (i: number) => Math.max(0, Math.min(entries.length - 1, i))

  return createPortal(
    <div
      data-testid="palette-modal"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 backdrop-blur-sm pt-24 p-4"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose()
      }}
      role="presentation"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="presentation"
        className={PALETTE_MODAL_SHELL}
      >
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault()
              setHighlighted((h) => clamp(h + 1))
            } else if (e.key === "ArrowUp") {
              e.preventDefault()
              setHighlighted((h) => clamp(h - 1))
            } else if (e.key === "Enter") {
              e.preventDefault()
              if (entries.length > 0) onSelect(highlighted)
            } else if (e.key === "Escape") {
              e.preventDefault()
              onClose()
            }
          }}
          placeholder="Jump to project…"
          autoComplete="off"
          spellCheck={false}
          className={PALETTE_INPUT}
        />
        <div className="max-h-80 overflow-y-auto">
          {entries.length === 0 ? (
            <div className="px-4 py-3 text-xs text-slate-500">No matches.</div>
          ) : (
            entries.map((entry, i) => (
              <button
                type="button"
                key={entry.id}
                data-testid="palette-row"
                data-highlighted={i === highlighted ? "true" : "false"}
                onMouseEnter={() => setHighlighted(i)}
                onClick={() => onSelect(i)}
                className={`block w-full text-left px-4 py-2 text-sm ${
                  i === highlighted
                    ? "bg-sky-100 dark:bg-sky-950/60 text-sky-900 dark:text-sky-100"
                    : "text-slate-700 dark:text-slate-200"
                }`}
              >
                {entry.label}
              </button>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
