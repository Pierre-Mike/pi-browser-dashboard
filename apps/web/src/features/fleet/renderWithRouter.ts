import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router"
import { createElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"

// Shared test helper: renders a component that needs a router context (it
// uses <Link>, e.g. FleetRunView's session links) via renderToStaticMarkup —
// this app's SSR-snapshot unit-testing convention (see SessionCard.test.tsx /
// PidSettingsView.test.tsx). Builds a throwaway single-route router rather
// than the app's real routeTree, so a test stays decoupled from every other
// route's data/markup — same approach Sidebar.test.tsx uses for its own
// router-dependent render.
export const renderWithRouter = async (component: () => ReactNode): Promise<string> => {
  const rootRoute = createRootRoute({ component })
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  })
  await router.load()
  return renderToStaticMarkup(createElement(RouterProvider, { router }))
}
