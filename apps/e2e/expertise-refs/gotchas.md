---
domain: apps/e2e
updated: 2026-07-30
updated_by: claude (mobile + tablet responsive pass)
---

# Gotchas

- **E2E-G001: pre-push e2e runs REAL claude spawns; CI runs the stub**
  confidence: 0.6 | added: 2026-07-23
  `scripts/check-e2e.sh` → `bun run test:e2e` with no stub env, so ~19 specs
  that spawn/drive real sessions (spawn-complete, drill-in, peek, send-keys,
  canvas-edit, sse-reconnect…) take ~28 min and can mass-fail when run from
  inside another Claude session or under quota pressure. The PR gate
  (`pr-e2e.yml`) sets `CI=true`, which forces the stub (~1.5 min, deterministic).
  Before blaming a diff: re-run with `PID_E2E_USE_STUB=1` — if that's green,
  the branch matches what CI checks, and `SKIP_E2E=1 git push` is the
  documented broken-env bypass.

- **E2E-G002: `setViewportSize` alone does not make a touch device — Chromium keeps reporting `pointer: fine`**
  confidence: 0.6 | added: 2026-07-30
  A narrow viewport is still a desktop browser as far as media queries go:
  `matchMedia("(pointer: coarse)")` and `(hover: none)` stay false at 390px, so
  any assertion about a `pointer-fine:` / `pointer-coarse:` / `hover:` variant is
  **vacuous** in an ordinary spec — it passes against the exact code it was
  written to catch. Use `test.use({ viewport, hasTouch: true, isMobile: true })`
  in a `describe` block, and assert
  `matchMedia("(pointer: coarse)").matches === true` inside the test first, so
  the emulation itself is proven rather than assumed. See the "a touch tablet"
  block in `responsive-shell.spec.ts`.

- **E2E-G003: `toHaveCSS("opacity", …)` on a child proves nothing about a transparent ancestor**
  confidence: 0.6 | added: 2026-07-30
  `opacity` is not an inherited property — it composites the subtree, so a
  button inside an `opacity-0` row reports its own computed `opacity: 1`. A
  hidden-until-hover row therefore passes `expect(button).toHaveCSS("opacity",
  "1")` *and* `expect(button).toBeVisible()` (Playwright's visibility check
  ignores opacity entirely). Locate the element the class sits on — add a testid
  to the row if it has none — or the test is measuring the wrong box.

- **E2E-G004: the static sidebar hides two different ways; only one detaches**
  confidence: 0.6 | added: 2026-07-30
  Below `lg` the `<aside data-testid="sidebar">` is still in the DOM with
  `hidden lg:flex`, so `not.toBeAttached()` times out — use `toBeHidden()`.
  `not.toBeAttached()` is correct only for the *other* mechanism: an expanded
  rail the user collapses, where `<Sidebar>` returns `null`
  (`left-edge-flush.spec.ts`, `sidebar-collapse-full.spec.ts`). Same element,
  two states, two matchers.

- **E2E-G005: a layout assertion over list content needs the list populated in the test**
  confidence: 0.6 | added: 2026-07-30
  `fullyParallel: false` with one worker means specs share daemon state, so a
  spec that measures the Activity feed inherits whatever cards earlier specs
  left behind. The phone horizontal-overflow assertion passed run alone (empty
  dashboard — nothing to overflow) and failed in the full suite at +83px. Either
  reading in isolation is a lie; `spawnSettled(page, { cwd: ensureProject(…) })`
  at the top of the test makes it the same measurement in both orders.
