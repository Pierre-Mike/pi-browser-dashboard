// Field descriptors + pure draft helpers for the global-settings form. Kept
// separate from React so the section/field layout and the coercion rules are
// unit-tested as data in / data out. The view iterates FIELD_GROUPS; the form
// hook uses setField/settingsEqual on the working draft.
import type { GlobalSettings } from "./types"

export type Section = keyof GlobalSettings
export type FieldType = "text" | "number"

export type FieldDescriptor = {
  readonly key: string
  readonly label: string
  readonly type: FieldType
  // What this value parameterizes — shown as helper text so the file reads
  // self-documenting.
  readonly hint: string
}

export type FieldGroup = {
  readonly section: Section
  readonly title: string
  readonly fields: readonly FieldDescriptor[]
}

export const FIELD_GROUPS: readonly FieldGroup[] = [
  {
    section: "git",
    title: "Git",
    fields: [
      {
        key: "defaultBranch",
        label: "Default branch",
        type: "text",
        hint: "Branch PRs target and diffs are based against",
      },
      { key: "remoteName", label: "Remote name", type: "text", hint: "Remote used for fetch/push" },
    ],
  },
  {
    section: "library",
    title: "Library",
    fields: [
      {
        key: "catalogPath",
        label: "Catalog path",
        type: "text",
        hint: "Path to the library catalog YAML",
      },
      {
        key: "agenticRepoPath",
        label: "Agentic repo path",
        type: "text",
        hint: "Checkout backing library installs",
      },
    ],
  },
  {
    section: "orchestration",
    title: "Orchestration",
    fields: [
      {
        key: "claudeBin",
        label: "Claude binary",
        type: "text",
        hint: "Command used to spawn sessions",
      },
      {
        key: "defaultAgent",
        label: "Default agent",
        type: "text",
        hint: "Pre-filled in the dispatch bar (blank = none)",
      },
      {
        key: "defaultPermissionMode",
        label: "Default permission mode",
        type: "text",
        hint: "Pre-filled permission mode (blank = none)",
      },
      {
        key: "defaultEffort",
        label: "Default effort",
        type: "text",
        hint: "Pre-filled reasoning effort (blank = none)",
      },
      {
        key: "maxParallel",
        label: "Max parallel",
        type: "number",
        hint: "Max sessions one dispatch may fan out to",
      },
    ],
  },
  {
    section: "network",
    title: "Network",
    fields: [
      {
        key: "projectsRoot",
        label: "Projects root",
        type: "text",
        hint: "Directory projects are discovered under",
      },
      { key: "appPort", label: "Daemon port", type: "number", hint: "Port the daemon listens on" },
      {
        key: "tunnelPort",
        label: "Tunnel port",
        type: "number",
        hint: "Local port the public tunnel exposes",
      },
    ],
  },
]

const isPosInt = (n: number): boolean => Number.isInteger(n) && n > 0

// Immutably set one field of one section from a raw input string. Numeric
// fields coerce; a non-positive-integer input leaves the previous value (so a
// half-typed "abc" never clobbers a valid port).
export const setField = ({
  settings,
  section,
  key,
  raw,
}: {
  settings: GlobalSettings
  section: Section
  key: string
  raw: string
}): GlobalSettings => {
  const group = FIELD_GROUPS.find((g) => g.section === section)
  const field = group?.fields.find((f) => f.key === key)
  if (!field) return settings
  const sectionObj = settings[section] as Record<string, unknown>
  let value: string | number = raw
  if (field.type === "number") {
    const n = Number(raw)
    if (!isPosInt(n)) return settings
    value = n
  }
  return { ...settings, [section]: { ...sectionObj, [key]: value } }
}

export const settingsEqual = (a: GlobalSettings, b: GlobalSettings): boolean =>
  JSON.stringify(a) === JSON.stringify(b)
