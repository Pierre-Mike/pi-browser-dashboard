---
domain: apps/web/src/features/sessions
updated: 2026-07-30
updated_by: claude (mobile + tablet responsive pass)
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

- **SES-C003: every primary surface spends exactly ONE row on chrome — identity, then the `lib/tabDock` nav, then actions**
  confidence: 0.7 | added: 2026-07-28
  The root dashboard, the project page and the session drill-in are the app's
  three navigable surfaces, and they must be interchangeable at a glance:
  `<SidebarReopenButton /> · ← · <h1 name + chips> · <nav {tabDockNavClass}> ·
  <actions>` inside one `flex items-center gap-2`, page container
  `flex flex-col gap-1 h-screen -my-4 pt-1`. The drill-in was the odd one out —
  a bordered `<header>` plus a second `border-b-2 -mb-px` underline strip — which
  pushed its terminal pane to y≈79 against the project page's y≈42. Do not
  hand-roll tab buttons on a new surface: import `tabDockNavClass` /
  `tabButtonClass` / `TAB_ICONS` so all three docks change together, and add the
  section's glyph to `TAB_ICONS` rather than inlining an SVG. Identity mirrors
  `ProjectIdentity`: one `h1` of inline chips, absolute path in `title=` only.

- **SES-C004: `SessionState.name` is typed `string` but arrives `undefined`**
  confidence: 0.8 | added: 2026-07-28
  The daemon omits `name` entirely for a session that was never named, so
  `session.name.trim()` throws "Cannot read properties of undefined" and the
  React error boundary swallows the WHOLE drill-in — the unit suites stay green
  because they never see a real payload, and the failure only shows up as an e2e
  timeout waiting for a testid that never renders. `apps/web/src/lib/types.ts`
  is hand-written and unvalidated (`(await res.json()) as SessionState` is
  ratcheted axiom debt), so treat any string field on it as
  `string | undefined` at the point of use. `sessionIdentity.ts` is the pure
  guard for the name/short pair; `session.name || session.short` is the older
  inline form used by `SessionCard`.

- **SES-C005: the shell's chrome row is ONE row at every width — the mobile drawer toggle rides in it, not above it**
  confidence: 0.6 | added: 2026-07-30
  SES-C001 said collapsed chrome must reserve zero width; the same rule applies
  to *height*, and the mobile nav broke it. `MobileNav` used to own a sticky
  `<header>` holding the hamburger, so every viewport below the breakpoint paid a
  second chrome row — 53px measured, on the axis a phone has least of — and
  because the fill-viewport panes are `h-dvh` boxes *below* that row, the row's
  height also pushed each pane's bottom exactly 53px past the fold. Both symptoms
  had one cause and one fix: delete the header, publish the drawer's open flag
  next to the rail flag (`sidebarRail.tsx`), and render the hamburger from
  `NavChromeChips` — the component all three primary surfaces already mount as
  the first item of the row they render anyway. The two chips are exact
  complements (`lg:hidden` vs `hidden lg:inline-flex`), so exactly one is visible
  at any width and the row costs one slot. Do not add a viewport-only bar to
  this shell; put the control in the row that exists.

- **SES-C006: `md` is 768px, which is an iPad in portrait — gate a sidebar on `lg`, and gate hover-reveal on the pointer, not on width**
  confidence: 0.6 | added: 2026-07-30
  Two separate bugs, one root cause: `md:` was being used as a proxy for "this is
  a desktop", and it is not. At `md` a tablet in portrait handed 288 of its 768px
  to a permanent rail and left ~450px for a terminal, so the static sidebar now
  starts at `lg` (`sidebarAsideClass` / `sidebarLoadingClass`) and tablets get the
  drawer. Worse, `SessionCardActions` hid its row behind `md:opacity-0
  md:group-hover:opacity-100`: an iPad satisfies `md` *and* cannot hover, so Kill
  / Delete / Send were transparent with no gesture that could reveal them. The
  gate is `pointer-fine:` — it asks the input device the question width was
  standing in for. When you reach for a breakpoint, check whether the real
  predicate is width (how much room is there?) or capability (can this pointer
  hover?); Tailwind 4 ships `pointer-fine` / `pointer-coarse` for the second.
  Both are proven in `apps/e2e/tests/responsive-shell.spec.ts`, and the touch
  half needs `isMobile: true` to be observable at all (E2E-G002).
