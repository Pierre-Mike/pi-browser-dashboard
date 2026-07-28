---
domain: apps/web/src/features/sessions
updated: 2026-07-28
updated_by: claude (left-edge flush collapse)
---

# Conventions

- **SES-C001: "collapsed" means zero layout width — put the reopen control in a row that already exists**
  confidence: 0.6 | added: 2026-07-28
  Any collapsible chrome (the desktop sidebar, the Specs/Brainstorm sub-tab
  rails) must render *nothing* when collapsed and must not make a sibling
  reserve clearance for it. Two ways this rule got broken and both read to the
  user as "the gap didn't go away": a `fixed` reopen button forced `<main>` into
  `md:pl-11`, an empty 44px column down the whole page height; and a collapsed
  rail left a `w-8` strip plus a `gap-2`, so the panel still started ~40px in.
  The fix pattern: the collapsed component returns `null`, and its reopen chip is
  rendered inline by a row the page renders anyway (the project topbar, the root
  dashboard's dock row, the session header) via `sidebarRail.tsx` /
  `RailExpandButton`. A row-local chip costs one row's width and nothing below
  it. Corollary: a page that hosts no top row also hosts no reopen chip — the
  loading / not-found branches rely on their `←` link back to a page that has
  one.

- **SES-C002: assert reclaimed space in pixels, never in class names**
  confidence: 0.6 | added: 2026-07-28
  `navChrome.test.ts` happily asserted `mainClass(true)` contains `md:pl-11` —
  the unit test *encoded* the gap, so the suite was green while the UI was
  wrong. Class-level tests can only lock in whatever padding is already there.
  Space-reclaiming changes need a Playwright measurement instead: collapse, then
  compare `boundingBox().x` of a panel **below** the top row against the page's
  own padding (`apps/e2e/tests/left-edge-flush.spec.ts`). Measure a panel, not
  the top row itself — that row legitimately holds the chip. Sanity-check the
  assertion by stashing the implementation and re-running: the old code must
  fail it (44px vs ≤20px, +39px rail residue), otherwise the test proves nothing.
