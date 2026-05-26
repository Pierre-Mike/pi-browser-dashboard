import { Outlet, createRootRoute } from "@tanstack/react-router"
import { PaletteController } from "../features/palette/PaletteController"
import { Sidebar } from "../features/sessions/Sidebar"
import { DropZone } from "../features/uploads/DropZone"

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <div className="flex items-start">
        <Sidebar />
        <main className="flex-1 min-w-0 px-4 py-4">
          <Outlet />
        </main>
      </div>
      <PaletteController />
      <DropZone />
    </div>
  )
}
