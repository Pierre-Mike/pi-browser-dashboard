import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import type { UsePersistedFlag } from "../../lib/collapse"
import { Sidebar } from "./Sidebar"

const fakeRail = (value: boolean): UsePersistedFlag => ({ value, toggle: () => {} })

// Sidebar reads useLocation/useParams, which need a router context — build a
// throwaway single-route router instead of the app's real routeTree so this
// test stays decoupled from every other route's data/markup.
const buildRouter = (rail: UsePersistedFlag) => {
  const rootRoute = createRootRoute({
    component: () => createElement(Sidebar, { rail }),
  })
  return createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  })
}

// Sessions/projects fetch through TanStack Query; SSR never runs the effect
// that triggers the request, so both queries stay in their initial isLoading
// state. That's enough to tell "renders nothing" apart from "renders the
// sidebar shell" without needing real session/project data.
const render = async (rail: UsePersistedFlag): Promise<string> => {
  const router = buildRouter(rail)
  await router.load()
  const qc = new QueryClient()
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client: qc }, createElement(RouterProvider, { router })),
  )
}

describe("Sidebar (desktop)", () => {
  test("collapsed: renders nothing at all — no rail chrome left behind", async () => {
    const html = await render(fakeRail(true))
    expect(html).toBe("")
    expect(html).not.toContain('data-testid="sidebar"')
    expect(html).not.toContain("sidebar-rail-toggle")
  })

  test("expanded: still renders the sidebar shell, not nothing", async () => {
    const html = await render(fakeRail(false))
    expect(html).not.toBe("")
    // Loading placeholder, since SSR never resolves the session/project fetch.
    expect(html).toContain("Loading")
  })
})

// The expanded shell never renders past the loading placeholder above
// (queries never resolve during SSR), so the header markup that follows is
// checked structurally against the source instead — same approach as
// SidebarBucket.test.ts / RecentSessionsFeed.test.ts for the same reason.
const sidebarSrc = readFileSync(join(import.meta.dir, "Sidebar.tsx"), "utf8")

describe("Sidebar header ('+ New session' folded in)", () => {
  test("no longer gets its own full-width bordered row below the header", () => {
    // That dedicated row used to cost a whole extra line for one button.
    expect(sidebarSrc).not.toContain('<div className="px-2 py-2 border-b border-base-300">')
    // The control itself — testid and click behaviour — must still exist,
    // just folded into the sticky header row instead.
    expect(sidebarSrc).toContain('data-testid="sidebar-new-session"')
    expect(sidebarSrc).toMatch(/onClick=\{\(\)\s*=>\s*setSpawn\(\{\s*project:\s*null\s*\}\)\}/)
  })
})
