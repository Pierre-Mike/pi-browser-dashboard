import { expect, type Page, test } from "@playwright/test"
import { cardLocator, ensureProject, spawnSettled } from "./helpers"

// The shell's small-screen behaviour, measured rather than asserted by class
// name — the same rule SES-C002 sets for the collapsed sidebar, and for the same
// reason: a unit test can only confirm the class string somebody already wrote.
//
// Three things were wrong and each is a measurement here:
//   1. The static sidebar appeared at `md` (768px) — exactly an iPad in
//      portrait — spending 288 of those pixels on a rail and leaving ~450px of
//      content. It now starts at `lg`.
//   2. The drawer's hamburger sat in a sticky bar of its own, so every screen
//      below the breakpoint paid a second chrome row (~53px of the scarcest
//      axis) AND had it overlap the top of each viewport-tall pane.
//   3. Those panes were `h-screen`. 100vh is the *large* viewport: it counts the
//      strip behind a phone's retractable URL bar, so the bottom of a terminal
//      sat below the fold.

// Device frames, not round numbers: iPhone 14 logical size, and an iPad Air in
// both orientations. The portrait tablet is the case the old `md` breakpoint got
// wrong, so it has to be a real one.
const PHONE = { width: 390, height: 844 }
const TABLET_PORTRAIT = { width: 820, height: 1180 }
const TABLET_LANDSCAPE = { width: 1180, height: 820 }

const openDashboard = async (page: Page, size: { width: number; height: number }) => {
  await page.setViewportSize(size)
  await page.goto("/")
  await expect(page.getByTestId("dashboard")).toBeVisible({ timeout: 15_000 })
}

// A page wider than its own viewport is the single most visible mobile defect:
// it rubber-bands sideways and clips the right edge of every row.
const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

test("a phone gets the drawer, the full width, and no sideways scroll", async ({ page }) => {
  // A populated Activity feed, not an empty one. The overflow this test is here
  // for comes from a *session card*, so an empty dashboard passes it vacuously —
  // which is exactly what happened: it went green run alone and red in the full
  // suite, where an earlier spec had left a card behind.
  await page.goto("/")
  const short = await spawnSettled(page, {
    cwd: ensureProject("responsive-feed", { gitInit: true }),
  })

  await openDashboard(page, PHONE)
  await expect(cardLocator(page, short)).toBeVisible()

  // No static rail below lg — it would leave ~100px for content at this width.
  // `toBeHidden`, not `not.toBeAttached`: the element stays mounted and removes
  // itself with `hidden lg:flex`, which costs no layout. (An *expanded* rail the
  // user then collapses does unmount — that is a different mechanism, and
  // left-edge-flush.spec.ts is where it is measured.)
  await expect(page.getByTestId("sidebar")).toBeHidden()

  const toggle = page.getByTestId("mobile-nav-toggle")
  await expect(toggle).toBeVisible()
  // The desktop reopen chip is the toggle's complement: never both, never
  // neither. Here it must be the one that is absent.
  await expect(page.getByTestId("sidebar-rail-open")).toBeHidden()

  // Tapped with a thumb, so it is sized for one — the 24px desktop chip is not.
  const toggleBox = await toggle.boundingBox()
  expect(toggleBox?.height ?? 0).toBeGreaterThanOrEqual(34)
  expect(toggleBox?.width ?? 0).toBeGreaterThanOrEqual(34)

  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1)
})

test("the drawer's toggle rides in the page's own chrome row, costing no second row", async ({
  page,
}) => {
  await openDashboard(page, PHONE)

  // The proof that no separate bar exists: the toggle and the tab dock share a
  // row, so the toggle's vertical centre lines up with the dock's.
  const toggle = await page.getByTestId("mobile-nav-toggle").boundingBox()
  const dock = await page.getByTestId("dashboard-tabs").boundingBox()
  if (!toggle || !dock) throw new Error("expected both chrome elements to be visible")

  const toggleMid = toggle.y + toggle.height / 2
  const dockMid = dock.y + dock.height / 2
  expect(Math.abs(toggleMid - dockMid)).toBeLessThanOrEqual(4)
  // …and it sits to the dock's left rather than above it.
  expect(toggle.x + toggle.width).toBeLessThanOrEqual(dock.x + 1)

  // Chrome starts at the very top of the page: nothing above it to scroll past.
  expect(toggle.y).toBeLessThanOrEqual(24)
})

test("the drawer opens the navigation and a link tap closes it again", async ({ page }) => {
  await openDashboard(page, PHONE)

  const drawer = page.getByTestId("mobile-nav-drawer")
  // Parked off-canvas: present in the DOM (so it can slide) but not on screen.
  const parked = await drawer.boundingBox()
  expect(parked?.x ?? 0).toBeLessThan(0)

  await page.getByTestId("mobile-nav-toggle").click()
  await expect(drawer.getByTestId("sidebar")).toBeVisible()
  await expect
    .poll(async () => (await drawer.boundingBox())?.x ?? -1, { timeout: 5_000 })
    .toBeGreaterThanOrEqual(0)

  // The drawer is how you navigate on a phone, so a link tap has to both
  // navigate and get out of the way.
  await drawer.getByTestId("sidebar-projects-link").click()
  await expect
    .poll(async () => (await drawer.boundingBox())?.x ?? 0, { timeout: 5_000 })
    .toBeLessThan(0)
})

test("a viewport-tall pane ends at the visible bottom on a phone, not 100vh below the top", async ({
  page,
}) => {
  await openDashboard(page, PHONE)
  await page.getByTestId("dashboard-tab-terminal").click()
  await expect(page.getByTestId("global-terminal")).toBeVisible()

  const m = await page.evaluate(() => {
    const pane = document.querySelector(
      '[data-testid="dashboard-tab-panel-terminal"]',
    ) as HTMLElement | null
    return {
      paneBottom: pane?.getBoundingClientRect().bottom ?? 0,
      paneTop: pane?.getBoundingClientRect().top ?? 0,
      viewportHeight: window.innerHeight,
    }
  })

  // The pane both starts inside the viewport and ends at its floor. With a
  // second sticky chrome row above it and an h-screen box, the bottom overshot
  // by the height of that row; with `-my-4` uncancelled it overshot by 16 more.
  expect(m.paneTop).toBeGreaterThanOrEqual(0)
  expect(m.viewportHeight - m.paneBottom).toBeLessThanOrEqual(8)
  expect(m.paneBottom - m.viewportHeight).toBeLessThanOrEqual(1)
})

test("a tablet in portrait keeps the drawer and spends its width on content", async ({ page }) => {
  await openDashboard(page, TABLET_PORTRAIT)

  // The regression this whole spec exists for: at `md` the rail appeared here.
  await expect(page.getByTestId("sidebar")).toBeHidden()
  await expect(page.getByTestId("mobile-nav-toggle")).toBeVisible()

  // The tab dock therefore runs nearly the full width instead of starting 288px
  // in. Left edge inside the page gutter, right edge at the far side.
  const dock = await page.getByTestId("dashboard-tabs").boundingBox()
  if (!dock) throw new Error("expected the tab dock to be visible")
  // 16px page gutter + the 36px toggle + an 8px gap; nothing like the 288px a
  // static rail would have cost.
  expect(dock.x).toBeLessThanOrEqual(70)
  expect(dock.x + dock.width).toBeGreaterThanOrEqual(TABLET_PORTRAIT.width - 30)

  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1)
})

// A real touch device, not just a narrow window: the whole point of the change
// is that the gate reads the *pointer*, and Playwright's plain Chromium reports
// `pointer: fine` at every viewport size, so a width-only test cannot see it —
// under `isMobile` the same emulator reports `pointer: coarse` / `hover: none`.
test.describe("a touch tablet", () => {
  test.use({ viewport: TABLET_PORTRAIT, hasTouch: true, isMobile: true })

  test("shows a card's controls without a hover it cannot perform", async ({ page }) => {
    await page.goto("/")
    const short = await spawnSettled(page, {
      cwd: ensureProject("responsive-touch", { gitInit: true }),
    })
    await page.goto("/")
    await expect(cardLocator(page, short)).toBeVisible()

    // Guard the guard: if the emulator ever reported a fine pointer here, the
    // assertion below would pass for the wrong reason and prove nothing.
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true)

    // The *row* carries the opacity, and opacity does not inherit as a computed
    // value — a transparent row still reports `opacity: 1` on the button inside
    // it, which is how the first version of this test passed against the very
    // code it was meant to catch. Measure the element the class is on.
    const row = cardLocator(page, short).locator("xpath=..").getByTestId("session-card-actions")
    await expect(row).toHaveCSS("opacity", "1")
    await expect(row.getByTestId("delete")).toBeVisible()
  })
})

test("a tablet in landscape has the room for the static rail, so it gets it", async ({ page }) => {
  await openDashboard(page, TABLET_LANDSCAPE)

  await expect(page.getByTestId("sidebar")).toBeVisible()
  // Exactly one shell-navigation control at any width: the rail is here, so the
  // hamburger is not.
  await expect(page.getByTestId("mobile-nav-toggle")).toBeHidden()

  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1)
})
