import { Link, Outlet, createRootRoute } from "@tanstack/react-router"
import { Sidebar } from "../features/sessions/Sidebar"

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <header className="sticky top-0 z-20 backdrop-blur bg-white/80 dark:bg-slate-950/80 border-b border-slate-200 dark:border-slate-800">
        <div className="px-4 py-2.5 flex items-center gap-4">
          <Link to="/" className="font-semibold text-sm whitespace-nowrap hover:underline">
            pi-browser-dashboard
          </Link>
        </div>
      </header>
      <div className="flex items-start">
        <Sidebar />
        <main className="flex-1 min-w-0 px-4 py-4">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
