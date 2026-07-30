import { createRootRoute, Outlet } from "@tanstack/react-router"
import { useCallback, useState } from "react"
import { useMachineTheme } from "../features/global-settings/useMachineTheme"
import { PaletteController } from "../features/palette/PaletteController"
import { MobileNav } from "../features/sessions/MobileNav"
import { mainClass } from "../features/sessions/navChrome"
import { Sidebar } from "../features/sessions/Sidebar"
import { SidebarRailProvider } from "../features/sessions/sidebarRail"
import { DropZone } from "../features/uploads/DropZone"
import { usePersistedFlag } from "../lib/collapse"
import { useTheme } from "../lib/ui/useTheme"

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  // Owned here (not inside <Sidebar>) so the sidebar's own collapse button and
  // every page's reopen chip share one instance — two separate usePersistedFlag
  // calls in the same tab don't sync with each other, only across tabs.
  const rail = usePersistedFlag("pid:sidebar:rail-collapsed")
  // The mobile drawer's flag is owned here for the same reason, plus one of its
  // own: the toggle renders inside <main> (in each page's chrome row) while the
  // drawer panel is a sibling of <main>, so no single component below can hold
  // both. NOT persisted — a drawer that reopens itself on the next page load is
  // a drawer nobody asked for.
  const [drawerOpen, setDrawerOpen] = useState(false)
  const closeDrawer = useCallback(() => setDrawerOpen(false), [])
  const drawer = { open: drawerOpen, toggle: () => setDrawerOpen((prev) => !prev) }
  // Keeps <html data-theme> in step with the resolved choice and the OS
  // preference. The dropdown in global settings reads the same store.
  useTheme()
  // …and the machine-wide default from the settings file feeds that same store,
  // for a browser that has never picked. Here rather than in the Settings tab:
  // the second device is the whole point, and it may never open Settings.
  useMachineTheme()

  return (
    // daisyUI runs with base:false, so this element *is* the page paint. Base
    // tokens rather than a slate literal: that is what makes a theme change the
    // background instead of only the components sitting on it.
    // dvh, not vh: 100vh on a phone includes the strip behind a retractable URL
    // bar, so a vh-floored shell hangs a scrollable band of empty gradient under
    // every page short enough to fit.
    <div className="min-h-dvh bg-gradient-to-b from-base-100 to-base-200 text-base-content">
      <SidebarRailProvider rail={rail} drawer={drawer}>
        <MobileNav open={drawerOpen} onClose={closeDrawer}>
          <Sidebar variant="drawer" />
        </MobileNav>
        <div className="flex items-start">
          <Sidebar rail={rail} />
          {/* No floating reopen button here: it would sit over page content, and
              the clearance it needed showed up as an empty strip down the whole
              left edge. Pages host <NavChromeChips /> in their top row. */}
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
