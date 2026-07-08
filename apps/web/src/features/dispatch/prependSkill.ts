// Prepend slash-commands for the chosen skills to the dispatch intent.
// Multiple skills are prepended in selection order (`/a /b intent`).
// Whitespace-only entries are dropped and duplicates collapse to the first
// occurrence. If the user already started the intent with their own slash
// command, we keep it as-is so the picker can't silently double up.
// `skillPrefix` is the harness's slash shape: Claude Code invokes a skill as
// `/name`, pi as `/skill:name` — see HARNESS_SKILL_PREFIXES in spawnHarness.ts.
export const prependSkill = ({
  skills,
  intent,
  skillPrefix = "/",
}: {
  skills: readonly string[]
  intent: string
  skillPrefix?: string
}): string => {
  const cleaned = skills.map((s) => s.trim()).filter((s) => s.length > 0)
  const unique = [...new Set(cleaned)]
  if (unique.length === 0) return intent
  if (/^\s*\//.test(intent)) return intent
  const prefix = unique.map((s) => `${skillPrefix}${s}`).join(" ")
  if (intent.length === 0) return prefix
  return `${prefix} ${intent}`
}
