// Versioned prompts for brainstorm AI companions (pure — unit-tested, repo
// convention: prompts live in code, not ad-hoc strings). A companion is a
// normal dispatched session whose intent starts with a machine-readable
// marker, so the roster can be recovered from the sessions list alone — no
// extra state store. Each role is one small focused agent (one agent, one
// job); running several roles at once is how "multiple AIs by my side" works.

export type CompanionRole = "review" | "beautify" | "critique" | "ideate"

export type CompanionRoleSpec = {
  readonly role: CompanionRole
  readonly label: string
  readonly title: string
  readonly mission: string
}

// The mission bodies are the contract between the UI buttons and the agent.
// Writing roles must stay non-destructive: the user's drawing is the source of
// truth, the agent augments or tidies it.
export const COMPANION_ROLES: readonly CompanionRoleSpec[] = [
  {
    role: "review",
    label: "Look at it",
    title: "Read the drawing and discuss it in chat",
    mission: [
      "Mission: READ the canvas file and discuss it — do NOT modify the file.",
      "Say what you understand the drawing to mean, call out anything unclear,",
      "and ask short questions where intent is ambiguous. When the user tells",
      "you to look again, re-read the file first — it changes as they draw.",
    ].join("\n"),
  },
  {
    role: "beautify",
    label: "Make it look better",
    title: "Tidy layout, alignment, colors and labels",
    mission: [
      "Mission: make the drawing LOOK better without changing what it says.",
      "Align nodes into tidy rows/columns, even out spacing, group related",
      "boxes (type 'group' + parentId), give clusters consistent colors, and",
      "clarify vague labels. Never delete the user's nodes or edges; keep every",
      "node id stable so their mental map survives your pass.",
    ].join("\n"),
  },
  {
    role: "critique",
    label: "Critique",
    title: "Add sticky-note critiques, opinions and propositions onto the canvas",
    mission: [
      "Mission: critique the design ON the canvas. For each opinion, risk, or",
      "counter-proposal, ADD a new note box near the node it concerns: label",
      'starts with "NOTE: ", data.color "1" (red) for problems/risks and',
      '"3" (yellow) for opinions/suggestions, and connect it to the node it',
      "critiques with a dashed-feel labeled edge. Do not move or delete the",
      "user's own nodes — notes only. Summarize your top points in chat too.",
    ].join("\n"),
  },
  {
    role: "ideate",
    label: "Add ideas",
    title: "Propose new ideas as green nodes wired into the drawing",
    mission: [
      "Mission: extend the brainstorm with NEW ideas. Add idea boxes with",
      'data.color "4" (green), connect them to the existing nodes they build',
      "on with labeled edges, and keep each idea label short (a phrase, not a",
      "paragraph). Do not move or delete the user's own nodes. Briefly pitch",
      "each idea in chat as well.",
    ].join("\n"),
  },
]

export const companionRoleSpec = (role: CompanionRole): CompanionRoleSpec => {
  const spec = COMPANION_ROLES.find((r) => r.role === role)
  if (!spec) throw new Error(`unknown companion role: ${role}`)
  return spec
}

// First line of every companion intent. The sessions list is the roster: a
// session belongs to brainstorm <slug> iff its intent starts with the slug
// marker, and the role segment maps it back to the button that spawned it.
export const companionMarker = (slug: string, role: CompanionRole): string =>
  `[brainstorm:${slug}:${role}]`

export const isCompanionIntent = (intent: string, slug: string): boolean =>
  intent.startsWith(`[brainstorm:${slug}:`)

export const companionRoleFromIntent = (intent: string): CompanionRole | null => {
  const m = /^\[brainstorm:[^:\]]+:([a-z]+)\]/.exec(intent)
  const role = m?.[1]
  return COMPANION_ROLES.some((r) => r.role === role) ? (role as CompanionRole) : null
}

// Shared canvas-format guide (same shape the session-canvas "Brief AI" button
// teaches, plus the color/group/note conventions the roles rely on).
const formatGuide = (file: string): string =>
  [
    "The brainstorm canvas is a JSON file at:",
    `  ${file}`,
    "",
    "Shape (React-Flow):",
    "  { version: 1, nodes: [{ id, position:{x,y}, type?, data:{label?, color?},",
    "                          parentId?, extent?: 'parent', style?:{width,height} }],",
    "    edges: [{ id, source, target, label?, data?:{color?, arrow?} }] }",
    "",
    "Conventions: type 'box' is a text box (data.label); type 'group' is a",
    "container (children set parentId + extent:'parent', coordinates relative",
    'to the group). data.color uses the Obsidian palette: "1" red, "2" orange,',
    '"3" yellow, "4" green, "5" cyan, "6" purple. Edge labels render on the',
    "arrow. Give new nodes unique ids and positions that don't overlap.",
    "",
    "Use your Read tool to see the drawing and your Write tool to update the",
    "whole file (valid JSON, atomic single Write). The user's browser canvas",
    "updates LIVE the moment you write the file — and the user keeps drawing,",
    "so re-read the file before every write.",
  ].join("\n")

export type CompanionIntentInput = {
  readonly role: CompanionRole
  readonly slug: string
  // Absolute path of the brainstorm document on disk.
  readonly file: string
  // Optional freeform instruction typed by the user, appended to the mission.
  readonly extra?: string
}

export const companionIntent = ({ role, slug, file, extra }: CompanionIntentInput): string => {
  const spec = companionRoleSpec(role)
  const lines = [
    companionMarker(slug, role),
    `You are a brainstorm companion (role: ${spec.role}) working side by side`,
    `with the user on the "${slug}" drawing board.`,
    "",
    formatGuide(file),
    "",
    spec.mission,
  ]
  if (extra && extra.trim() !== "") lines.push("", `User's note: ${extra.trim()}`)
  lines.push(
    "",
    "Stay available: after finishing a pass, keep the conversation open in",
    "this terminal — the user will nudge you here when the drawing changes.",
  )
  return lines.join("\n")
}

// Follow-up message typed into an already-running companion's terminal when
// the user hits the same role button again (or sends a custom note).
export const companionNudge = (file: string, message: string): string => {
  const note = message.trim()
  return [
    `I updated the drawing — re-read ${file} and continue your mission.`,
    ...(note === "" ? [] : [`Also: ${note}`]),
  ].join(" ")
}
