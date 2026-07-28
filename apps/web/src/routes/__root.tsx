import { createRootRoute, Outlet } from "@tanstack/react-router"
import { PaletteController } from "../features/palette/PaletteController"
import { MobileNav } from "../features/sessions/MobileNav"
import { mainClass } from "../features/sessions/navChrome"
import { Sidebar } from "../features/sessions/Sidebar"
import { SidebarRailProvider } from "../features/sessions/sidebarRail"
import { DropZone } from "../features/uploads/DropZone"
import { usePersistedFlag } from "../lib/collapse"

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  // Owned here (not inside <Sidebar>) so the sidebar's own collapse button and
  // every page's reopen chip share one instance — two separate usePersistedFlag
  // calls in the same tab don't sync with each other, only across tabs.
  const rail = usePersistedFlag("pid:sidebar:rail-collapsed")

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 text-slate-900 dark:text-slate-100">
      <SidebarRailProvider rail={rail}>
        <MobileNav>
          <Sidebar variant="drawer" />
        </MobileNav>
        <div className="flex items-start">
          <Sidebar rail={rail} />
          {/* No floating reopen button here: it would sit over page content, and
              the clearance it needed showed up as an empty strip down the whole
              left edge. Pages host <SidebarReopenButton /> in their top row. */}
          <main className={mainClass}>
            <Outlet />
          </main>
        </div>
        <PaletteController />
        <DropZone />
      </SidebarRailProvider>
    </div>
  )
}
