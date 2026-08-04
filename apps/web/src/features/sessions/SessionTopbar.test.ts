import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// SessionTopbar mounts a TanStack <Link>, so rendering it needs a RouterProvider
// the way SessionDrillIn builds one — out of reach synchronously here. Checked
// structurally instead, same approach as SidebarBucket.test.ts.
const src = readFileSync(join(import.meta.dir, "SessionTopbar.tsx"), "utf8")
const projectSrc = readFileSync(
  join(import.meta.dir, "..", "projects", "ProjectDashboard.tsx"),
  "utf8",
)

describe("session topbar", () => {
  it("spends ONE row on identity + tabs + actions, like the project page", () => {
    // The drill-in used to stack a <header> (title, badge, actions) on top of a
    // separate bordered tab strip — two rows of chrome where the project page
    // spends one, and every terminal / chat pane paid for the second row in
    // height.
    expect(src).toMatch(/data-testid="session-topbar"\s+className="flex items-center gap-2"/)
    expect(src).not.toContain("<header")
    expect(src).not.toContain("flex-wrap")
  })

  it("navigates with the shared tab dock instead of a bespoke underline strip", () => {
    expect(src).toContain('from "../../lib/tabDock"')
    expect(src).toContain("tabDockNavClass")
    expect(src).toContain("tabButtonClass")
    // The old hand-rolled tab buttons drew their own bottom-border underline.
    expect(src).not.toContain("border-b-2 -mb-px")
  })

  it("sizes the dock to its tabs instead of stretching an empty bar across the row", () => {
    // With four tabs `flex-1` filled the slack. With Terminal (now the surface,
    // not a tab) and Chat (deleted) gone, two tabs left a wide empty bordered
    // box that read as an input field, so the dock hugs its content and the
    // action buttons take the slack instead.
    expect(src).toContain("shrink min-w-0")
    expect(src).not.toContain("flex-1 min-w-0")
    expect(src).toContain("shrink-0 ml-auto")
  })

  it("keeps every session tab reachable under its established testid", () => {
    // e2e specs (terminal-fit, chat-fullwidth, brainstorms, drill-in) click
    // these — moving to the dock must not rename them.
    expect(src).toMatch(/data-testid=\{`tab-\$\{t\.key\}`\}/)
    expect(src).toContain('role="tablist"')
    expect(src).toContain('data-testid="session-tabs"')
  })

  it("shapes identity like ProjectIdentity: one h1 of inline chips, path in the title", () => {
    // Byte-identical class list to ProjectIdentity's h1 — the two surfaces must
    // size and truncate their titles the same way.
    const h1 = "text-sm font-semibold flex items-center gap-1.5 min-w-0 shrink"
    expect(projectSrc).toContain(`className="${h1}"`)
    expect(src).toContain(`const IDENTITY_H1 = "${h1}"`)
    // The absolute cwd is one hover away rather than spending inline width, the
    // way the project page stopped printing its path inline.
    expect(src).toContain("title={session.cwd}")
    expect(src).not.toContain("· {session.cwd}")
    expect(src).toContain('data-testid="session-short"')
  })

  it("takes its title and chip from the shared naming rule, not an inline fallback", () => {
    // A blank name used to leave the title empty: `session?.name ?? id` keeps ""
    // (?? only catches null/undefined), and the old header only looked filled
    // because the cwd suffix sat beside it. sessionIdentity.ts owns that rule
    // and is unit-tested directly.
    expect(src).toContain('from "./sessionIdentity"')
    expect(src).toContain("sessionIdentity(session)")
    expect(src).not.toContain("session?.name")
  })

  it("borrows the project page's muted back arrow, not a wide text link", () => {
    const arrow = 'className="text-[11px] text-base-content/60 hover:underline shrink-0"'
    expect(projectSrc).toContain(arrow)
    expect(src).toContain(arrow)
    expect(src).not.toContain("← All sessions")
  })

  it("hosts the collapsed-sidebar reopen chip as the topbar's first item", () => {
    // No reserved left column: the chip lives in this row, so the terminal /
    // chat panes below run flush to the left edge.
    expect(src).toContain('from "./sidebarRail"')
    expect(src).toMatch(/data-testid="session-topbar"[^>]*>\s*<NavChromeChips\s*\/>/)
  })

  it("keeps every drill-in action button under its established testid", () => {
    for (const id of ["peek", "stop", "delete"]) {
      expect(src).toContain(`data-testid="${id}"`)
    }
    expect(src).toContain("Open in CLI ↗")
  })

  it("tints Kill / Delete with semantic tokens so both themes adapt without dark: pairs", () => {
    for (const raw of ["amber-", "rose-", "slate-", "dark:"]) expect(src).not.toContain(raw)
    expect(src).toContain("bg-warning/15")
    expect(src).toContain("bg-error/15")
  })
})
