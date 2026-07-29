// Pure class-name helpers for the responsive navigation chrome. Kept free of
// React so the slide/visibility logic is unit-testable without a renderer.

export type SidebarVariant = "desktop" | "drawer"

// Off-canvas → on-canvas slide for the mobile drawer panel.
export const drawerPanelClass = (open: boolean): string =>
  open ? "translate-x-0" : "-translate-x-full"

// Fade + click-through toggle for the scrim behind the open drawer.
export const drawerBackdropClass = (open: boolean): string =>
  open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"

// The desktop sidebar is a sticky rail hidden on phones; the same component
// rendered inside the mobile drawer must instead fill the drawer panel.
// Collapsing the rail no longer shrinks it to a slim strip — the desktop
// <Sidebar> renders nothing at all once collapsed (see Sidebar.tsx), handing
// the full width to <main> and leaving one small reopen chip
// (sidebarRailOpenBtnClass) in the page's own top row. So there is only one
// desktop shape left to describe here.
// Semantic tokens, not a slate literal: the sidebar is the largest surface on
// the page, and a hard-coded white/slate-950 pair made every non-pid theme look
// half-applied — a warm-paper shell next to a pure-white rail.
export const sidebarAsideClass = (variant: SidebarVariant): string =>
  variant === "drawer"
    ? "flex h-full w-full flex-col bg-base-100 overflow-y-auto"
    : "hidden md:flex shrink-0 flex-col w-72 border-r border-base-300 bg-base-100 h-screen sticky top-0 overflow-y-auto"

export const sidebarLoadingClass = (variant: SidebarVariant): string =>
  variant === "drawer"
    ? "block w-full p-3 text-xs text-base-content/60"
    : "hidden md:block w-72 shrink-0 border-r border-base-300 p-3 text-xs text-base-content/60"

// <main>'s padding — uniform on every side, collapsed or not. An earlier
// version widened the left side on md+ to clear a *floating* reopen button,
// which showed up as an empty column running the whole page height. The reopen
// control is now an inline chip in each page's top row (SidebarReopenButton),
// so the collapsed rail hands its full width to the content.
export const mainClass = "flex-1 min-w-0 px-4 py-4"

// The small button that restores a fully-collapsed desktop sidebar. Rendered
// inline as the first item of a page's top row, so it costs one row's worth of
// width and nothing below it. Desktop-only (md:) — phones use the MobileNav
// drawer's hamburger instead.
export const sidebarRailOpenBtnClass =
  "hidden md:inline-flex shrink-0 h-6 w-6 items-center justify-center rounded-md border border-base-300 bg-base-100 text-base-content/60 shadow-sm hover:bg-base-200 hover:text-base-content"
