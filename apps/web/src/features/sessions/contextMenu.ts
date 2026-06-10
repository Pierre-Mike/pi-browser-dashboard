export type MenuPoint = { x: number; y: number }

// Clamp a context-menu anchor so the menu stays fully on-screen: overflowing
// edges flip the menu left/up of the cursor, and tiny viewports floor at 0.
export const clampMenuPosition = ({
  x,
  y,
  menuWidth,
  menuHeight,
  viewportWidth,
  viewportHeight,
}: {
  x: number
  y: number
  menuWidth: number
  menuHeight: number
  viewportWidth: number
  viewportHeight: number
}): MenuPoint => ({
  x: Math.max(0, Math.min(x, viewportWidth - menuWidth)),
  y: Math.max(0, Math.min(y, viewportHeight - menuHeight)),
})
