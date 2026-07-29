// Field descriptors + pure draft helpers for the global-settings form. Kept
// separate from React so the section/field layout and the coercion rules are
// unit-tested as data in / data out. The view iterates FIELD_GROUPS; the form
// hook uses setField/reseedDraft/toFormPatch on the working draft.
import type { GlobalSettings, GlobalSettingsPatch } from "@pid/shared"

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

/**
 * What this form is allowed to write back — every section it renders a control
 * for, and nothing else.
 *
 * `ui` is excluded on purpose. The Appearance section writes that half directly,
 * so it can change *after* the draft was seeded; posting the whole draft would
 * then revert the machine default the user had just set, with no field on screen
 * to explain why.
 */
export const toFormPatch = (settings: GlobalSettings): GlobalSettingsPatch => ({
  git: settings.git,
  library: settings.library,
  orchestration: settings.orchestration,
  network: settings.network,
  skillGroups: settings.skillGroups,
})

/** Do two documents agree on everything this form can edit? Drives `dirty`. */
export const formSectionsEqual = (a: GlobalSettings, b: GlobalSettings): boolean =>
  JSON.stringify(toFormPatch(a)) === JSON.stringify(toFormPatch(b))

/**
 * Which working draft survives the persisted settings changing underneath.
 *
 * The settings query has two writers now — this form's Save, and the Appearance
 * section's "set as this machine's default" — so a re-seed can be triggered by
 * something the user was not doing. Re-seeding unconditionally would discard
 * whatever they were typing. So: adopt the new value only when the draft is
 * untouched since it was last seeded; otherwise the edits win and stay dirty.
 */
export const reseedDraft = ({
  draft,
  seeded,
  stored,
}: {
  draft: GlobalSettings | undefined
  seeded: GlobalSettings | undefined
  stored: GlobalSettings
}): GlobalSettings =>
  draft === undefined || seeded === undefined || settingsEqual(draft, seeded) ? stored : draft
