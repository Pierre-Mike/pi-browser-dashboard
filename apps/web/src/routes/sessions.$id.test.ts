import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// The drill-in wires router hooks (useParams / useSearch) to live TanStack Query
// data — rendering it needs the same router + resolved-query scaffolding
// SessionDrillIn itself builds, which SSR can't reach synchronously. Checked
// structurally instead, same approach as SidebarBucket.test.ts.
const src = readFileSync(join(import.meta.dir, "sessions.$id.tsx"), "utf8")

describe("session drill-in route", () => {
  it("composes one topbar and one panel — no second row of chrome", () => {
    // It used to inline a <header> (title, badge, actions) plus a bordered tab
    // strip underneath: two rows where the project page spends one, and every
    // terminal / chat pane paid for the second row in height.
    expect(src).toContain("<SessionTopbar")
    expect(src).toContain("<SessionPanel")
    expect(src).not.toContain("<header")
    expect(src).not.toContain("border-b-2 -mb-px")
  })

  it("sizes the page as a viewport-tall flex column, like the project dashboard", () => {
    expect(src).toContain('className="flex flex-col gap-1 h-screen -my-4 pt-1"')
  })

  it("takes its ?tab= whitelist from the shared dock definition", () => {
    // A tab listed in the dock but missing from the whitelist would 404 its own
    // deep link, so both come from one source.
    expect(src).toContain('from "../features/sessions/sessionTabs"')
    expect(src).toContain("staticKeys: SESSION_TABS")
    expect(src).not.toMatch(/const SESSION_TABS = \[/)
  })

  it("keeps a deep link to one brainstorm board through validateSearch", () => {
    // `?tab=brainstorm:<encoded path>` names a board inside the Brainstorm
    // section; a fixed-enum coercion would silently drop it back to Terminal.
    expect(src).toContain("coerceNamespacedTab")
    expect(src).toContain("prefixes: [BOARD_TAB_PREFIX]")
  })

  it("keeps Terminal as the tab a bare /sessions/:id opens on", () => {
    expect(src).toContain('const { tab = "terminal" }')
  })

  it("delegates the action state to the shared hook rather than owning it", () => {
    expect(src).toContain("useSessionActions({ id, session })")
    for (const gone of ["setStopping", "setDeleting", "setPeeking", "confirmTimerRef"]) {
      expect(src).not.toContain(gone)
    }
  })

  it("still renders the peek summary under the topbar", () => {
    expect(src).toContain('data-testid="peek-summary"')
    expect(src).toContain("actions.peekSummary")
  })

  it("paints with semantic tokens, not the raw Tailwind palette", () => {
    for (const raw of ["slate-", "amber-", "rose-", "dark:"]) expect(src).not.toContain(raw)
  })
})
