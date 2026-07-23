import type { SessionState } from "../../lib/types"

// Versioned prompt for the Excalidraw board companion (pure — unit-tested,
// repo convention: prompts live in code, not ad-hoc strings). Unlike the V1
// brainstorm roles there is deliberately NO mission: the session only knows
// which file the user is drawing on right now, and everything else happens in
// chat. A companion is a normal dispatched session whose intent starts with a
// machine-readable marker, so the panel recovers it from the sessions list
// alone — no extra state store.

export const excalidrawMarker = (slug: string): string => `[excalidraw:${slug}]`

export const isExcalidrawCompanionIntent = (intent: string, slug: string): boolean =>
  intent.startsWith(excalidrawMarker(slug))

// A companion answers keystrokes until it dies; once stopped or failed it no
// longer counts, so the start button is free to spawn a fresh one.
export const isLiveExcalidrawCompanion = (s: SessionState): boolean =>
  s.state !== "stopped" && s.state !== "failed"

export type ExcalidrawCompanionIntentInput = {
  readonly slug: string
  // Absolute path of the Excalidraw document on disk.
  readonly file: string
}

export const excalidrawCompanionIntent = ({ slug, file }: ExcalidrawCompanionIntentInput): string =>
  [
    excalidrawMarker(slug),
    `We are working on the "${slug}" Excalidraw drawing right now, side by side.`,
    "The document is this file:",
    `  ${file}`,
    "",
    "It is Excalidraw's native JSON format:",
    '  { "type": "excalidraw", "version": 2, "elements": [ ... ], "appState": { ... } }',
    "Use your Read tool to see the drawing and your Write tool to update the",
    "whole file (valid JSON, one atomic Write). The user's browser canvas",
    "updates LIVE the moment you write the file — and the user keeps drawing,",
    "so re-read the file before every write. Give new elements unique ids.",
    "",
    "No fixed mission: the user tells you what they want in this chat. Stay",
    "available after every pass — this terminal is the conversation.",
  ].join("\n")
