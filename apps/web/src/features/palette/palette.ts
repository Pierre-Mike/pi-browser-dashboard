import type { Project } from "../../lib/types"
import { THEME_PALETTE_ACTIONS } from "../../lib/ui/theme.core"

// A row is either a project to open or a command to run. One shape with a `kind`
// discriminant rather than a union, so PaletteModal keeps rendering rows without
// knowing what they do — only `selectRowAt` cares.
export type PaletteEntry = {
  kind: "project" | "action"
  label: string
  id: string
}

export type PaletteHandle = {
  isOpen(): boolean
  tap(t: number, mods?: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): void
  nonShiftKey(): void
  esc(): void
  getEntries(query: string): ReadonlyArray<PaletteEntry>
  selectRowAt(index: number): void
  setProjects(projects: ReadonlyArray<Project>): void
  dispose(): void
}

export type PaletteDeps = {
  onSelectProject: (project: Project) => void
  onRunAction: (id: string) => void
}

export const DOUBLE_SHIFT_WINDOW_MS = 300

// Commands are registered here, once, and are always present — a fresh install
// with no projects still has a way to change theme without opening Settings.
// They sort after the projects because jumping to a project is what the palette
// is mostly for; a query narrows to them the moment you type "theme".
const ACTION_ENTRIES: ReadonlyArray<PaletteEntry> = THEME_PALETTE_ACTIONS.map((action) => ({
  kind: "action" as const,
  label: action.label,
  id: action.id,
}))

const buildEntries = (projects: ReadonlyArray<Project>): ReadonlyArray<PaletteEntry> => [
  ...[...projects]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({ kind: "project" as const, label: p.name, id: p.id })),
  ...ACTION_ENTRIES,
]

const filterEntries = (
  entries: ReadonlyArray<PaletteEntry>,
  query: string,
): ReadonlyArray<PaletteEntry> => {
  if (!query) return entries
  const q = query.toLowerCase()
  return entries.filter((e) => e.label.toLowerCase().includes(q))
}

export const installPalette = (deps: PaletteDeps): PaletteHandle => {
  let open = false
  let lastShiftTime: number | null = null
  let projects: ReadonlyArray<Project> = []
  let cachedEntries: ReadonlyArray<PaletteEntry> = ACTION_ENTRIES
  let lastComputed: ReadonlyArray<PaletteEntry> = []

  const close = () => {
    open = false
  }

  const processTap = (t: number) => {
    if (lastShiftTime !== null && t - lastShiftTime <= DOUBLE_SHIFT_WINDOW_MS) {
      open = !open
      lastShiftTime = null
    } else {
      lastShiftTime = t
    }
  }

  return {
    isOpen: () => open,
    tap(t, mods) {
      if (mods && (mods.ctrlKey || mods.metaKey || mods.altKey)) return
      processTap(t)
    },
    nonShiftKey() {
      lastShiftTime = null
    },
    esc() {
      if (open) close()
    },
    getEntries(query) {
      lastComputed = filterEntries(cachedEntries, query)
      return lastComputed
    },
    selectRowAt(index) {
      const entry = lastComputed[index]
      if (!entry) return
      close()
      if (entry.kind === "action") {
        deps.onRunAction(entry.id)
        return
      }
      const project = projects.find((p) => p.id === entry.id)
      if (project) deps.onSelectProject(project)
    },
    setProjects(next) {
      projects = next
      cachedEntries = buildEntries(next)
    },
    dispose() {
      open = false
      lastShiftTime = null
      projects = []
      cachedEntries = ACTION_ENTRIES
      lastComputed = []
    },
  }
}
