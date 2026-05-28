// Prepend a Claude Code slash-command for the chosen skill to the dispatch
// intent. If the user already started the intent with their own slash command,
// we keep it as-is so the picker can't silently double up.
export const prependSkill = (skill: string, intent: string): string => {
  const s = skill.trim()
  if (s.length === 0) return intent
  if (/^\s*\//.test(intent)) return intent
  if (intent.length === 0) return `/${s}`
  return `/${s} ${intent}`
}
