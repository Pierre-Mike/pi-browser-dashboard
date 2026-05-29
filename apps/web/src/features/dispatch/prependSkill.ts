// Prepend Claude Code slash-commands for the chosen skills to the dispatch
// intent. Multiple skills are prepended in selection order (`/a /b intent`).
// Whitespace-only entries are dropped and duplicates collapse to the first
// occurrence. If the user already started the intent with their own slash
// command, we keep it as-is so the picker can't silently double up.
export const prependSkill = (skills: readonly string[], intent: string): string => {
  const cleaned = skills.map((s) => s.trim()).filter((s) => s.length > 0)
  const unique = [...new Set(cleaned)]
  if (unique.length === 0) return intent
  if (/^\s*\//.test(intent)) return intent
  const prefix = unique.map((s) => `/${s}`).join(" ")
  if (intent.length === 0) return prefix
  return `${prefix} ${intent}`
}
