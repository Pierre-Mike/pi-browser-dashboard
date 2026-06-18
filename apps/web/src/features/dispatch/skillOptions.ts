export type SkillRef = { readonly id: string }

// Merge global + project skills into the picker's option list. The default
// skill is always surfaced first (even before any dir scan returns) so the
// picker isn't empty on first paint. `pinned` skills (e.g. a project's stored
// default selection) follow the default so they always render as buttons even
// if the skill dir scan hasn't returned them yet. Project skills follow global
// ones; everything is deduped, first occurrence wins.
export const mergeSkillOptions = ({
  defaultSkill,
  pinned = [],
  globalSkills = [],
  projectSkills = [],
}: {
  defaultSkill: string
  pinned?: readonly string[]
  globalSkills?: readonly SkillRef[]
  projectSkills?: readonly SkillRef[]
}): string[] => {
  const ids = [...globalSkills, ...projectSkills].map((s) => s.id)
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of [defaultSkill, ...pinned, ...ids]) {
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}
