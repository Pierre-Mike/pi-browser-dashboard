// Pure class-name helpers for the responsive navigation chrome. Kept free of
// React so the slide/visibility logic is unit-testable without a renderer.

export type SidebarVariant = "desktop" | "drawer"

// Off-canvas → on-canvas slide for the mobile drawer panel.
export const drawerPanelClass = (open: boolean): string =>
  open ? "translate-x-0" : "-translate-x-full"

// Fade + click-through toggle for the scrim behind the open drawer.
export const drawerBackdropClass = (open: boolean): string =>
  open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"

// The static sidebar is a sticky rail hidden below `lg`; the same component
// rendered inside the mobile drawer must instead fill the drawer panel.
// Collapsing the rail no longer shrinks it to a slim strip — the desktop
// <Sidebar> renders nothing at all once collapsed (see Sidebar.tsx), handing
// the full width to <main> and leaving one small reopen chip
// (sidebarRailOpenBtnClass) in the page's own top row. So there is only one
// desktop shape left to describe here.
// Semantic tokens, not a slate literal: the sidebar is the largest surface on
// the page, and a hard-coded white/slate-950 pair made every non-pid theme look
// half-applied — a warm-paper shell next to a pure-white rail.
//
// `lg` and not `md`: md is 768px, which is exactly an iPad in portrait, so the
// old breakpoint handed a tablet a permanent 288px rail and left ~450px for a
// terminal. Tablets get the drawer; the rail starts where a window can spare it.
// `h-dvh` and not `h-screen` for a related reason — 100vh is the *large*
// viewport, i.e. it counts the strip behind a phone's retractable URL bar, so a
// vh-tall rail parks its own footer below the fold.
export const sidebarAsideClass = (variant: SidebarVariant): string =>
  variant === "drawer"
    ? "flex h-full w-full flex-col bg-base-100 overflow-y-auto"
    : "hidden lg:flex shrink-0 flex-col w-72 border-r border-base-300 bg-base-100 h-dvh sticky top-0 overflow-y-auto"

export const sidebarLoadingClass = (variant: SidebarVariant): string =>
  variant === "drawer"
    ? "block w-full p-3 text-xs text-base-content/60"
    : "hidden lg:block w-72 shrink-0 border-r border-base-300 p-3 text-xs text-base-content/60"

// <main>'s padding — no state-dependent left column. An earlier version widened
// the left side on md+ to clear a *floating* reopen button, which showed up as
// an empty column running the whole page height. The reopen control is now an
// inline chip in each page's top row (NavChromeChips), so the collapsed rail
// hands its full width to the content.
//
// The horizontal half is responsive and the vertical half is not, on purpose: a
// phone has ~390px to spend and 16px of gutter per side is 8% of it, while the
// vertical padding is what fillViewportClass's `-my-4` cancels, so making it
// responsive would need a matching responsive negative margin for no gain.
export const mainClass = "flex-1 min-w-0 px-2 sm:px-4 py-4"

// The three primary surfaces (root dashboard, project page, session drill-in)
// size their fill-the-window tabs — terminal, files, chat, a spec host — with
// this. Shared rather than repeated, because it *was* repeated: the same literal
// was written out per surface, so a fix had to be applied three times or it
// silently landed on two. Each caller adds its own `pt-*`; the surfaces do not
// agree on that one and unifying it would be a density change, not a mobile one.
export const fillViewportClass = "h-dvh -my-4"

// The small button that restores a fully-collapsed static sidebar. Rendered
// inline as the first item of a page's top row, so it costs one row's worth of
// width and nothing below it. Only where that sidebar exists (lg+) — narrower
// viewports reach navigation through drawerToggleBtnClass instead.
export const sidebarRailOpenBtnClass =
  "hidden lg:inline-flex shrink-0 h-6 w-6 items-center justify-center rounded-btn border border-base-300 bg-base-100 text-base-content/60 shadow-sm hover:bg-base-200 hover:text-base-content"

// The drawer's hamburger — the exact complement of the chip above, present only
// below `lg`, where there is no static sidebar to reopen. It rides in the same
// already-rendered chrome row rather than in a sticky bar of its own: that bar
// cost every phone a whole row of the scarcest axis on the smallest screen AND
// overlapped the top of each viewport-tall pane beneath it (SES-C001).
//
// 36px where the desktop chip is 24px. It is the only route to navigation below
// lg and it is hit with a thumb, so it is sized for one.
export const drawerToggleBtnClass =
  "lg:hidden shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-btn border border-base-300 bg-base-100 text-base-content/80 shadow-sm hover:bg-base-200 hover:text-base-content"
