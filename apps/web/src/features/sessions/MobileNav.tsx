import { type ReactNode, useState } from "react"
import { drawerBackdropClass, drawerPanelClass } from "./navChrome"

// Phone-only top bar + slide-in drawer. The desktop sidebar is hidden below
// `md`, so without this there is no way to reach projects/sessions on a phone.
// Renders its navigation `children` (the drawer-variant Sidebar) so this stays
// router-agnostic and unit-testable; any link tap inside closes the drawer.
export const MobileNav = ({ children }: { children: ReactNode }) => {
  const [open, setOpen] = useState(false)
  const closeOnLink = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("a")) setOpen(false)
  }

  return (
    <>
      <header className="md:hidden sticky top-0 z-30 flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-950/90 backdrop-blur px-3 py-2">
        <button
          type="button"
          data-testid="mobile-nav-toggle"
          aria-label="Open navigation"
          aria-expanded={open}
          onClick={() => setOpen(true)}
          className="-ml-1 inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-900"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="h-5 w-5"
          >
            <line x1="4" y1="7" x2="20" y2="7" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="17" x2="20" y2="17" />
          </svg>
        </button>
      </header>

      <button
        type="button"
        data-testid="mobile-nav-backdrop"
        aria-label="Close navigation"
        aria-hidden={!open}
        tabIndex={open ? 0 : -1}
        onClick={() => setOpen(false)}
        className={`md:hidden fixed inset-0 z-40 bg-slate-900/50 transition-opacity duration-200 ${drawerBackdropClass(open)}`}
      />

      {/* biome-ignore lint/a11y/useKeyWithClickEvents: delegated link-tap close; the drawer's own controls remain keyboard-operable. */}
      <div
        data-testid="mobile-nav-drawer"
        onClick={closeOnLink}
        className={`md:hidden fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] transform shadow-xl transition-transform duration-200 ${drawerPanelClass(open)}`}
      >
        {/* Lazy: the drawer body (a second Sidebar) is only mounted while open,
            so it never duplicates the desktop sidebar's testids/links nor opens
            a redundant data subscription. */}
        {open ? children : null}
      </div>
    </>
  )
}
