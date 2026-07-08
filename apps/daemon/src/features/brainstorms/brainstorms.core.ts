import path from "node:path"
import { NAME_RE } from "../../platform/extensions/manifest"

// A brainstorm is one named canvas document stored inside the project at
// .pid/brainstorms/<id>.canvas.json. Keeping the file project-local (rather
// than in ~/.claude/jobs like the per-session canvas) means it is
// git-versionable and any AI session spawned with the project as cwd can
// Read/Write the drawing with plain file tools.

const BRAINSTORM_SUFFIX = ".canvas.json"

export type Brainstorm = {
  readonly id: string
  readonly label: string
  // Absolute path of the canvas document — surfaced to the web UI so the
  // companion prompts can point an agent directly at the file.
  readonly file: string
  readonly updatedAt: string
}

// Same charset the pid-app creator enforces, so brainstorm ids stay safe as
// path segments and as `?tab=brainstorm:<id>` URL params.
export const isCreatableBrainstormName = (name: string): boolean => NAME_RE.test(name)

export const brainstormsDirFor = (projectPath: string): string =>
  path.join(projectPath, ".pid", "brainstorms")

export const brainstormFileName = (id: string): string => `${id}${BRAINSTORM_SUFFIX}`

// Inverse of brainstormFileName for discovery: null for anything that is not a
// well-formed <id>.canvas.json basename. Untrusted directory contents must
// never crash discovery, so bad names are skipped, not thrown.
export const brainstormIdFromFileName = (filename: string): string | null => {
  if (!filename.endsWith(BRAINSTORM_SUFFIX)) return null
  const id = filename.slice(0, -BRAINSTORM_SUFFIX.length)
  return NAME_RE.test(id) ? id : null
}

// Deterministic order: alphabetical by id.
export const discoverBrainstormIds = (filenames: readonly string[]): readonly string[] =>
  filenames
    .map(brainstormIdFromFileName)
    .filter((id): id is string => id !== null)
    .sort()
