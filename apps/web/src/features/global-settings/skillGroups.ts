// Pure edit helpers for the skill-groups section of the global-settings draft.
// Creation/replacement happens from the spawn modal (upsertSkillGroup); the
// settings panel only lists and removes, so removal is all that lives here.
import type { SkillGroup } from "./types"

// Drop the first group whose name matches (others left untouched, order kept).
export const removeSkillGroup = (groups: readonly SkillGroup[], name: string): SkillGroup[] =>
  groups.filter((g) => g.name !== name)
