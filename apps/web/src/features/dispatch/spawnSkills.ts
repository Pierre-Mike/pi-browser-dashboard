// Pure helpers for the spawn modal's skill selection. No React — the hook
// (useSpawnSkills) wires these to query state and the component renders them.

export const DEFAULT_SKILL = "goal"

// Compare two selections for equality (order-sensitive, since selection order
// is meaningful — it determines slash-command prepend order).
export const sameSkills = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i])

// Toggle a skill id in/out of the current selection, preserving order.
export const toggleSkill = (selected: readonly string[], id: string): string[] =>
  selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]

// The selection to seed the picker with: the project's stored default when a
// project is in scope and its settings have loaded, else the global fallback.
// An explicit empty stored list is honored (no skills pre-selected).
export const resolveDefaultSkills = (
  hasProject: boolean,
  storedDefault: readonly string[] | undefined,
): readonly string[] => (hasProject ? (storedDefault ?? [DEFAULT_SKILL]) : [DEFAULT_SKILL])
