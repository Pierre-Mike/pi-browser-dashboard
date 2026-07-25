import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// The drill-in header pulls together router hooks (useParams) and live
// TanStack Query data (session, transcript) — rendering it needs the same
// router + resolved-query scaffolding SessionDrillIn itself builds, which SSR
// can't reach synchronously. Checked structurally instead, same approach as
// SidebarBucket.test.ts / RecentSessionsFeed.test.ts for the same reason.
const src = readFileSync(join(import.meta.dir, "sessions.$id.tsx"), "utf8")

describe("session drill-in header", () => {
  it("folds short id + cwd into the h1 row instead of a separate metadata row underneath", () => {
    // That row used to cost a whole extra line under the title, duplicating
    // info already reachable via hover / the URL.
    expect(src).not.toContain(
      'className="text-[11px] text-base-content/50 flex flex-wrap gap-x-2 mt-0.5"',
    )
    expect(src).toContain("{session.short} · {session.cwd}")
  })

  it("keeps the full cwd path reachable as a hover title even though it's inline now", () => {
    expect(src).toMatch(/title=\{session\.cwd\}/)
  })
})
