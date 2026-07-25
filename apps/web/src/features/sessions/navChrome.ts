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
// the full width to <main> and leaving one small floating reopen button
// (sidebarRailOpenBtnClass) in its place. So there is only one desktop shape
// left to describe here.
export const sidebarAsideClass = (variant: SidebarVariant): string =>
  variant === "drawer"
    ? "flex h-full w-full flex-col bg-white dark:bg-slate-950 overflow-y-auto"
    : "hidden md:flex shrink-0 flex-col w-72 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 h-screen sticky top-0 overflow-y-auto"

export const sidebarLoadingClass = (variant: SidebarVariant): string =>
  variant === "drawer"
    ? "block w-full p-3 text-xs text-slate-500"
    : "hidden md:block w-72 shrink-0 border-r border-slate-200 dark:border-slate-800 p-3 text-xs text-slate-500"

// <main>'s left padding: normally the uniform px-4, but while the desktop
// rail is fully collapsed it widens on md+ viewports to clear the floating
// reopen button so page content never sits under it. Phones never show that
// button (it's md:-only), so their left padding stays the normal size.
export const mainClass = (collapsed: boolean): string =>
  collapsed ? "flex-1 min-w-0 pl-4 md:pl-11 pr-4 py-4" : "flex-1 min-w-0 px-4 py-4"

// The small floating button that restores a fully-collapsed desktop sidebar.
// Desktop-only (md:) — phones use the MobileNav drawer's hamburger instead.
export const sidebarRailOpenBtnClass =
  "hidden md:inline-flex fixed left-2 top-2 z-40 h-7 w-7 items-center justify-center rounded-md border border-base-300 bg-base-100 text-base-content/60 shadow-sm hover:bg-base-200 hover:text-base-content"
