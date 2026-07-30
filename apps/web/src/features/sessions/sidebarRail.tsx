import { createContext, type ReactNode, useContext } from "react"
import type { UsePersistedFlag } from "../../lib/collapse"
import { drawerToggleBtnClass, sidebarRailOpenBtnClass } from "./navChrome"

// The two bits of navigation state a *page* has to be able to render a control
// for, published by RootLayout so any page can host both in its own top row.
// Reserving a column in <main> for a floating button left a visible gap down the
// whole left edge; a sticky mobile bar cost a whole row of height on the screens
// with the least of it. An inline chip in a row that already exists costs
// nothing below that row (SES-C001).
const SidebarRailContext = createContext<UsePersistedFlag>({ value: false, toggle: () => {} })

export type DrawerState = {
  readonly open: boolean
  readonly toggle: () => void
}

const DrawerContext = createContext<DrawerState>({ open: false, toggle: () => {} })

export const SidebarRailProvider = ({
  rail,
  drawer,
  children,
}: {
  readonly rail: UsePersistedFlag
  readonly drawer: DrawerState
  readonly children: ReactNode
}) => (
  <SidebarRailContext.Provider value={rail}>
    <DrawerContext.Provider value={drawer}>{children}</DrawerContext.Provider>
  </SidebarRailContext.Provider>
)

// Renders only while the static sidebar is fully collapsed, and only at the
// widths where that sidebar exists at all.
const SidebarReopenChip = () => {
  const rail = useContext(SidebarRailContext)
  if (!rail.value) return null
  return (
    <button
      type="button"
      data-testid="sidebar-rail-open"
      onClick={rail.toggle}
      title="Show sidebar"
      aria-label="Show sidebar"
      className={sidebarRailOpenBtnClass}
    >
      <span aria-hidden>»</span>
    </button>
  )
}

// Below `lg` there is no static sidebar, so this is the only route to projects
// and sessions. Unconditional for exactly that reason — the chip above may hide
// itself when the rail is open, this one may not.
const DrawerToggle = () => {
  const drawer = useContext(DrawerContext)
  return (
    <button
      type="button"
      data-testid="mobile-nav-toggle"
      aria-label="Open navigation"
      aria-expanded={drawer.open}
      onClick={drawer.toggle}
      className={drawerToggleBtnClass}
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
  )
}

// Every page top row mounts one of these as its first item. Exactly one of the
// two halves is visible at any width — the hamburger below `lg`, the reopen chip
// above it — so the row spends one slot on shell navigation whatever the screen.
export const NavChromeChips = () => (
  <>
    <DrawerToggle />
    <SidebarReopenChip />
  </>
)
