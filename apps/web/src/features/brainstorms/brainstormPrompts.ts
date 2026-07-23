import type { SessionState } from "../../lib/types"

// Versioned prompt for a brainstorm-canvas companion (pure — unit-tested, repo
// convention: prompts live in code, not ad-hoc strings). Mirrors the V2
// Excalidraw companion: there is deliberately NO mission and NO role. A
// companion is one plain session whose only context is which canvas file the
// user is drawing on right now; everything else happens in this chat. Several
// such sessions can attach to one board at once — a clean one for ideas, a
// separate one for tidying — and each is a normal dispatched session whose
// intent starts with a machine-readable marker, so the panel recovers the whole
// roster from the sessions list alone — no extra store.

export const brainstormMarker = (slug: string): string => `[brainstorm:${slug}]`

// A brainstorm session belongs to board <slug> iff its intent starts with the
// slug marker. The closing bracket delimits the slug, so a slug never claims a
// longer slug's sessions (`[brainstorm:auth]` ≠ `[brainstorm:auth-flow]`).
export const isBrainstormCompanionIntent = (intent: string, slug: string): boolean =>
  intent.startsWith(brainstormMarker(slug))

// A companion answers keystrokes until it dies; once stopped or failed it no
// longer counts, so the panel drops its chip and the terminal falls back to
// another live session (or the empty state).
export const isLiveBrainstormCompanion = (s: SessionState): boolean =>
  s.state !== "stopped" && s.state !== "failed"

export type BrainstormCompanionIntentInput = {
  readonly slug: string
  // Absolute path of the brainstorm canvas document on disk.
  readonly file: string
}

export const brainstormCompanionIntent = ({ slug, file }: BrainstormCompanionIntentInput): string =>
  [
    brainstormMarker(slug),
    `We are working on the "${slug}" brainstorm board right now, side by side.`,
    "The document is this file:",
    `  ${file}`,
    "",
    "It is a React-Flow canvas in JSON:",
    "  { version: 1, nodes: [{ id, position:{x,y}, type?, data:{label?, color?},",
    "                          parentId?, extent?: 'parent', style?:{width,height} }],",
    "    edges: [{ id, source, target, label?, data?:{color?, arrow?} }] }",
    "Use your Read tool to see the drawing and your Write tool to update the",
    "whole file (valid JSON, one atomic Write). The user's browser canvas",
    "updates LIVE the moment you write the file — and the user keeps drawing,",
    "so re-read the file before every write. Give new nodes unique ids.",
    "",
    "No fixed mission: the user tells you what they want in this chat. Stay",
    "available after every pass — this terminal is the conversation.",
  ].join("\n")
