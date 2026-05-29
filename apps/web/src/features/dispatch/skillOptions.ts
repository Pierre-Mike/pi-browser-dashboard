export type SkillRef = { readonly id: string }

// Merge global + project skills into the picker's option list. The default
// skill is always surfaced first (even before any dir scan returns) so the
// picker isn't empty on first paint. Project skills follow global ones, deduped.
export const mergeSkillOptions = (
  defaultSkill: string,
  globalSkills: readonly SkillRef[] = [],
  projectSkills: readonly SkillRef[] = [],
): string[] => {
  const ids = [...globalSkills, ...projectSkills].map((s) => s.id)
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of [defaultSkill, ...ids]) {
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}
