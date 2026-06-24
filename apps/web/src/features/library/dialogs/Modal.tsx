import { type ReactNode, useEffect, useRef } from "react"
import { MODAL_PANEL } from "./modalLayout"

type Props = {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  testId?: string
}

export const Modal = ({ open, title, onClose, children, testId }: Props) => {
  const ref = useRef<HTMLDialogElement>(null)

  // Show via the native top layer (showModal) rather than a plain z-indexed
  // <dialog open>. A non-modal dialog stays in normal stacking order, so the
  // xterm terminal canvas — its own stacking context — painted over it: a
  // session clicked in the sidebar opened the reply modal *behind* the
  // terminal, invisible and unclickable. The top layer renders above every
  // sibling stacking context regardless of z-index. We only mount the dialog
  // while open (see the early return below), and unmounting removes it from
  // the top layer, so there is nothing to close() here.
  // Mount-only: the early return below unmounts the dialog whenever it closes,
  // so each open is a fresh mount and this runs exactly once per opening.
  useEffect(() => {
    const dlg = ref.current
    if (dlg && !dlg.open) dlg.showModal()
  }, [])

  if (!open) return null
  return (
    // Backdrop: clicking the empty area dismisses; Esc fires the native
    // `cancel` event (handled below). We use a native <dialog> so the role and
    // modality are implicit. max-w/max-h-none override the UA modal sizing so
    // the overlay fills the viewport.
    <dialog
      ref={ref}
      aria-label={title}
      data-testid={testId}
      className="fixed inset-0 z-50 m-0 max-w-none max-h-none w-full h-full bg-base-content/40 backdrop:bg-base-content/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose()
      }}
      onCancel={(e) => {
        // Native Esc also closes the dialog and fires `cancel`; drive React
        // state so the element unmounts and the two stay in sync.
        e.preventDefault()
        onClose()
      }}
    >
      <div className={MODAL_PANEL}>
        <header className="flex items-center justify-between px-4 py-2 border-b border-base-300">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            data-testid="library-modal-close"
            className="text-xs rounded px-2 py-1 hover:bg-base-200"
          >
            Close
          </button>
        </header>
        <div className="px-4 py-3 text-sm flex flex-col gap-3">{children}</div>
      </div>
    </dialog>
  )
}
