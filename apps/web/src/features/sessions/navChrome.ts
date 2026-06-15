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
export const sidebarAsideClass = (variant: SidebarVariant): string =>
  variant === "drawer"
    ? "flex h-full w-full flex-col bg-white dark:bg-slate-950 overflow-y-auto"
    : "hidden md:flex w-72 shrink-0 flex-col border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 h-screen sticky top-0 overflow-y-auto"

export const sidebarLoadingClass = (variant: SidebarVariant): string =>
  variant === "drawer"
    ? "block w-full p-3 text-xs text-slate-500"
    : "hidden md:block w-72 shrink-0 border-r border-slate-200 dark:border-slate-800 p-3 text-xs text-slate-500"
