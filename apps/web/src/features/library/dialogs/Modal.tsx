import { type ReactNode, useEffect } from "react"

type Props = {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  testId?: string
}

export const Modal = ({ open, title, onClose, children, testId }: Props) => {
  useEffect(() => {
    if (!open) return undefined
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [open, onClose])

  if (!open) return null
  return (
    // Backdrop: clicking the empty area dismisses; Esc dismisses via the effect above.
    // We use a native <dialog> element so the role and modality are implicit.
    <dialog
      open
      aria-label={title}
      data-testid={testId}
      className="fixed inset-0 z-50 m-0 max-w-none w-full h-full bg-slate-900/40 dark:bg-slate-950/60 backdrop:bg-slate-900/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose()
      }}
    >
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl max-w-lg w-full mx-4 max-h-[80vh] overflow-auto">
        <header className="flex items-center justify-between px-4 py-2 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            data-testid="library-modal-close"
            className="text-xs rounded px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Close
          </button>
        </header>
        <div className="px-4 py-3 text-sm flex flex-col gap-3">{children}</div>
      </div>
    </dialog>
  )
}
