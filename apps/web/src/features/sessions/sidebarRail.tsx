import { createContext, type ReactNode, useContext } from "react"
import type { UsePersistedFlag } from "../../lib/collapse"
import { sidebarRailOpenBtnClass } from "./navChrome"

// The desktop sidebar's collapse flag, published by RootLayout so any page can
// host the reopen control in its own top row. Reserving a column in <main> for a
// floating button left a visible gap down the whole left edge; an inline chip in
// a row that already exists costs nothing below that row.
const SidebarRailContext = createContext<UsePersistedFlag>({ value: false, toggle: () => {} })

export const SidebarRailProvider = ({
  rail,
  children,
}: {
  readonly rail: UsePersistedFlag
  readonly children: ReactNode
}) => <SidebarRailContext.Provider value={rail}>{children}</SidebarRailContext.Provider>

// Renders only while the desktop sidebar is fully collapsed. Every page top row
// mounts one as its first item, so the control sits where the user last saw the
// sidebar header without pushing content right.
export const SidebarReopenButton = () => {
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
