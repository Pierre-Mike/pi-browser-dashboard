import type { ReactNode } from "react"
import { drawerBackdropClass, drawerPanelClass } from "./navChrome"

// The slide-in navigation drawer for every viewport below `lg`, where the static
// sidebar is hidden and this is the only way to reach projects/sessions.
//
// Controlled, and deliberately headless: the hamburger that opens it used to
// live here inside a sticky <header> of its own, which made this component cost
// a whole chrome row that only small screens paid for — and a row that then
// overlapped the top of every viewport-tall pane below it. The toggle now rides
// in the one chrome row each page already renders (NavChromeChips, next to the
// desktop reopen chip), so `open` is owned by RootLayout and threaded to both
// halves. Renders its navigation `children` (the drawer-variant Sidebar) so this
// stays router-agnostic and unit-testable; any link tap inside closes it.
export const MobileNav = ({
  open,
  onClose,
  children,
}: {
  readonly open: boolean
  readonly onClose: () => void
  readonly children: ReactNode
}) => {
  const closeOnLink = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("a")) onClose()
  }

  return (
    <>
      <button
        type="button"
        data-testid="mobile-nav-backdrop"
        aria-label="Close navigation"
        aria-hidden={!open}
        tabIndex={open ? 0 : -1}
        onClick={onClose}
        className={`lg:hidden fixed inset-0 z-40 bg-base-content/50 transition-opacity duration-200 ${drawerBackdropClass(open)}`}
      />

      {/* biome-ignore lint/a11y/useKeyWithClickEvents: delegated link-tap close; the drawer's own controls remain keyboard-operable. */}
      <div
        data-testid="mobile-nav-drawer"
        onClick={closeOnLink}
        className={`lg:hidden fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] transform shadow-xl transition-transform duration-200 ${drawerPanelClass(open)}`}
      >
        {/* Lazy: the drawer body (a second Sidebar) is only mounted while open,
            so it never duplicates the desktop sidebar's testids/links nor opens
            a redundant data subscription. */}
        {open ? children : null}
      </div>
    </>
  )
}
