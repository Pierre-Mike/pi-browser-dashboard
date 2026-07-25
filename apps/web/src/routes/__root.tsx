import { createRootRoute, Outlet } from "@tanstack/react-router"
import { PaletteController } from "../features/palette/PaletteController"
import { MobileNav } from "../features/sessions/MobileNav"
import { mainClass, sidebarRailOpenBtnClass } from "../features/sessions/navChrome"
import { Sidebar } from "../features/sessions/Sidebar"
import { DropZone } from "../features/uploads/DropZone"
import { usePersistedFlag } from "../lib/collapse"

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  // Owned here (not inside <Sidebar>) so the floating reopen button below and
  // the sidebar's own in-rail collapse button share one instance — two
  // separate usePersistedFlag calls in the same tab don't sync with each
  // other, only across tabs.
  const rail = usePersistedFlag("pid:sidebar:rail-collapsed")

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 text-slate-900 dark:text-slate-100">
      <MobileNav>
        <Sidebar variant="drawer" />
      </MobileNav>
      <div className="flex items-start">
        <Sidebar rail={rail} />
        {rail.value ? (
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
        ) : null}
        <main className={mainClass(rail.value)}>
          <Outlet />
        </main>
      </div>
      <PaletteController />
      <DropZone />
    </div>
  )
}
