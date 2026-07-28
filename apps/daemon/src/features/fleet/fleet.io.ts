// Imperative shell for fleet recipes: reads and parses <root>/.pid/fleet.json
// for an ALREADY-RESOLVED project root.
//
// Plain async function returning a discriminated result rather than an Effect
// service, mirroring brainstorms.io.ts / projects/fileBrowser.io: once the
// caller (fleet.routes.ts, given a root by its injected resolver) knows which
// tree to read, there is no dependency left to inject and no Layer to
// compose.

import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { type Fleet, type FleetError, parseFleetFile } from "./fleet.core"

export type FleetReadResult = {
  readonly fleets: ReadonlyArray<Fleet>
  readonly errors: ReadonlyArray<FleetError>
}

const tryReadText = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, "utf8")
  } catch {
    return null
  }
}

/**
 * Absent file is not an error — mirrors pid-settings' own missing-file
 * fallback: a project with no fleet.json simply has no recipes yet. Malformed
 * JSON degrades to a single file-level FleetError rather than throwing, the
 * same "surface it, don't crash" contract the field validators use.
 */
export const readFleetFile = async (root: string): Promise<FleetReadResult> => {
  const text = await tryReadText(join(root, ".pid", "fleet.json"))
  if (text === null || text.trim() === "") return { fleets: [], errors: [] }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return {
      fleets: [],
      errors: [{ fleet: "(file)", step: undefined, message: "fleet.json is not valid JSON" }],
    }
  }
  const parsed = parseFleetFile(raw)
  return parsed._tag === "Right"
    ? { fleets: parsed.right.fleets, errors: [] }
    : { fleets: [], errors: parsed.left }
}
