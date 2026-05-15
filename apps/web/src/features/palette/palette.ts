import type { Project } from "../../lib/types"

export type PaletteEntry = {
  kind: "project"
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
}

export const DOUBLE_SHIFT_WINDOW_MS = 300

const buildEntries = (projects: ReadonlyArray<Project>): ReadonlyArray<PaletteEntry> =>
  [...projects]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({ kind: "project" as const, label: p.name, id: p.id }))

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
  let cachedEntries: ReadonlyArray<PaletteEntry> = []
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
      cachedEntries = []
      lastComputed = []
    },
  }
}
