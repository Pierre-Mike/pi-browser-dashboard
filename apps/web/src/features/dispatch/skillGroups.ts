// Pure helpers for skill *groups* (named presets stored in global settings).
// No React — useSpawnSkills wires these to query state and the picker renders
// the result. A group is a reusable set of skills the user can apply in one
// click at spawn time, or save the current selection as.
import type { SkillGroup } from "../global-settings/types"

// Apply a group's skills to the current selection: additive union, preserving
// order (current picks first, then the group's skills not already chosen).
// Applying a group never removes a manual pick — it only adds what's missing.
export const applyGroupToSelection = (
  selected: readonly string[],
  groupSkills: readonly string[],
): string[] => {
  const seen = new Set(selected)
  const out = [...selected]
  for (const id of groupSkills) {
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

// Insert or replace a group by name (first match wins, position preserved).
// A blank name or empty skill list yields the list unchanged — a group must be
// nameable and carry at least one skill to be worth storing.
export const upsertSkillGroup = (
  groups: readonly SkillGroup[],
  group: SkillGroup,
): SkillGroup[] => {
  const name = group.name.trim()
  if (name === "" || group.skills.length === 0) return [...groups]
  const next: SkillGroup = { name, skills: group.skills }
  const idx = groups.findIndex((g) => g.name === name)
  if (idx === -1) return [...groups, next]
  return groups.map((g, i) => (i === idx ? next : g))
}

// Look up a group's skills by name (empty list when not found).
export const groupSkills = (groups: readonly SkillGroup[], name: string): readonly string[] =>
  groups.find((g) => g.name === name)?.skills ?? []
