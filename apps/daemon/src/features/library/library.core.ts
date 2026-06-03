// Pure parsers and helpers for the Library catalog (~/.claude/skills/library/library.yaml).
// No I/O — file reads + git ops live in library.repo.ts.
//
// The catalog is the source-of-truth for what's *available*; install status is
// derived per-call by probing the filesystem in library.repo.ts.

import {
  type Document,
  type YAMLMap,
  type YAMLSeq,
  isMap,
  isSeq,
  parseDocument,
  parse as parseYaml,
} from "yaml"

export const LIBRARY_CATEGORIES = [
  "skills",
  "agents",
  "tools",
  "prompts",
  "statuslines",
  "extensions",
] as const
export type LibraryCategory = (typeof LIBRARY_CATEGORIES)[number]

export type LibraryEntry = {
  readonly name: string
  readonly type: LibraryCategory
  readonly description: string
  readonly source: string
  readonly requires?: readonly string[]
}

export type ScopeDirs = {
  readonly default: string
  readonly global: string
}

export type Catalog = {
  readonly defaultDirs: Record<LibraryCategory, ScopeDirs>
  readonly entries: readonly LibraryEntry[]
}

export type ParsedSource =
  | { readonly kind: "local"; readonly absPath: string; readonly dir: string }
  | {
      readonly kind: "github"
      readonly org: string
      readonly repo: string
      readonly branch: string
      readonly filePath: string
      readonly dir: string
      readonly cloneUrl: string
    }

export type InstallStatus = "installed" | "not_installed"

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

const isStringList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string")

// Singularised typed-ref prefixes used in `requires:` lists.
const PREFIX_TO_CATEGORY: Record<string, LibraryCategory> = {
  skill: "skills",
  skills: "skills",
  agent: "agents",
  agents: "agents",
  tool: "tools",
  tools: "tools",
  prompt: "prompts",
  prompts: "prompts",
  statusline: "statuslines",
  statuslines: "statuslines",
  extension: "extensions",
  extensions: "extensions",
}

export const parseRequireRef = (
  ref: string,
): { readonly category: LibraryCategory; readonly name: string } | null => {
  const colon = ref.indexOf(":")
  if (colon <= 0 || colon === ref.length - 1) return null
  const prefix = ref.slice(0, colon).trim().toLowerCase()
  const name = ref.slice(colon + 1).trim()
  const category = PREFIX_TO_CATEGORY[prefix]
  if (!category || !name) return null
  return { category, name }
}

const DEFAULT_DIRS: Record<LibraryCategory, ScopeDirs> = {
  skills: { default: ".claude/skills/", global: "~/.claude/skills/" },
  agents: { default: ".claude/agents/", global: "~/.claude/agents/" },
  tools: { default: ".claude/tools/", global: "~/.claude/tools/" },
  prompts: { default: ".claude/commands/", global: "~/.claude/commands/" },
  statuslines: { default: ".claude/statuslines/", global: "~/.claude/statuslines/" },
  extensions: { default: ".pi/extensions/", global: "~/.pi/agent/extensions/" },
}

// Read a default_dirs block of the shape:
//   skills:
//     - default: .claude/skills/
//     - global: ~/.claude/skills/
const readDefaultDirs = (raw: unknown): Record<LibraryCategory, ScopeDirs> => {
  const out: Record<LibraryCategory, ScopeDirs> = {
    skills: { ...DEFAULT_DIRS.skills },
    agents: { ...DEFAULT_DIRS.agents },
    tools: { ...DEFAULT_DIRS.tools },
    prompts: { ...DEFAULT_DIRS.prompts },
    statuslines: { ...DEFAULT_DIRS.statuslines },
    extensions: { ...DEFAULT_DIRS.extensions },
  }
  if (!isObject(raw)) return out
  for (const category of LIBRARY_CATEGORIES) {
    const blockRaw = raw[category]
    if (!Array.isArray(blockRaw)) continue
    const dirs: { default?: string; global?: string } = {}
    for (const entry of blockRaw) {
      if (!isObject(entry)) continue
      if (typeof entry.default === "string") dirs.default = entry.default
      if (typeof entry.global === "string") dirs.global = entry.global
    }
    if (dirs.default || dirs.global) {
      out[category] = {
        default: dirs.default ?? out[category].default,
        global: dirs.global ?? out[category].global,
      }
    }
  }
  return out
}

const readEntries = (raw: unknown): readonly LibraryEntry[] => {
  if (!isObject(raw)) return []
  const out: LibraryEntry[] = []
  for (const category of LIBRARY_CATEGORIES) {
    const arr = raw[category]
    if (!Array.isArray(arr)) continue
    for (const item of arr) {
      if (!isObject(item)) continue
      const name = typeof item.name === "string" ? item.name : ""
      const description = typeof item.description === "string" ? item.description : ""
      const source = typeof item.source === "string" ? item.source : ""
      if (!name || !source) continue
      const entry: LibraryEntry = {
        name,
        type: category,
        description,
        source,
        ...(isStringList(item.requires) ? { requires: item.requires } : {}),
      }
      out.push(entry)
    }
  }
  return out
}

export class CatalogParseError extends Error {
  override readonly name = "CatalogParseError"
}

export const parseCatalog = (text: string): Catalog => {
  if (text.trim() === "") {
    return { defaultDirs: { ...DEFAULT_DIRS }, entries: [] }
  }
  let doc: unknown
  try {
    doc = parseYaml(text)
  } catch (e) {
    throw new CatalogParseError(e instanceof Error ? e.message : "invalid YAML")
  }
  if (!isObject(doc)) {
    throw new CatalogParseError("catalog root must be a mapping")
  }
  const defaultDirs = readDefaultDirs(doc.default_dirs)
  const entries = readEntries(doc.library)
  return { defaultDirs, entries }
}

const GITHUB_BLOB = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/
const GITHUB_RAW = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/

const dirOf = (p: string): string => {
  const slash = p.lastIndexOf("/")
  return slash <= 0 ? "" : p.slice(0, slash)
}

// Parse a `source:` value into a typed shape the repo can act on.
// Returns null for inputs that don't match any supported format so callers
// can surface a clear `source_invalid` error to the UI.
export const parseSource = (source: string, homeDir: string): ParsedSource | null => {
  if (source.startsWith("/") || source.startsWith("~")) {
    const absPath = source.startsWith("~") ? `${homeDir}${source.slice(1)}` : source
    return { kind: "local", absPath, dir: dirOf(absPath) }
  }
  const blob = GITHUB_BLOB.exec(source)
  if (blob) {
    const [, org, repo, branch, filePath] = blob
    return {
      kind: "github",
      org: org ?? "",
      repo: repo ?? "",
      branch: branch ?? "main",
      filePath: filePath ?? "",
      dir: dirOf(filePath ?? ""),
      cloneUrl: `https://github.com/${org}/${repo}.git`,
    }
  }
  const raw = GITHUB_RAW.exec(source)
  if (raw) {
    const [, org, repo, branch, filePath] = raw
    return {
      kind: "github",
      org: org ?? "",
      repo: repo ?? "",
      branch: branch ?? "main",
      filePath: filePath ?? "",
      dir: dirOf(filePath ?? ""),
      cloneUrl: `https://github.com/${org}/${repo}.git`,
    }
  }
  return null
}

export class RequiresCycleError extends Error {
  override readonly name = "RequiresCycleError"
  constructor(public readonly chain: readonly string[]) {
    super(`require cycle: ${chain.join(" → ")}`)
  }
}

// Resolve the transitive closure of `requires` for one entry. Returns the
// ordered list with dependencies first and the entry itself last so callers
// can install in order. Cycles throw `RequiresCycleError`. References that
// don't resolve to a catalog entry are skipped silently — the UI surfaces
// missing deps in a separate pass during install.
export const resolveRequires = (entryName: string, catalog: Catalog): readonly LibraryEntry[] => {
  const byKey = new Map<string, LibraryEntry>()
  for (const e of catalog.entries) byKey.set(`${e.type}:${e.name}`, e)

  const rootCandidates = catalog.entries.filter((e) => e.name === entryName)
  if (rootCandidates.length === 0) return []

  const visited = new Set<string>()
  const out: LibraryEntry[] = []

  const visit = (entry: LibraryEntry, chain: readonly string[]): void => {
    const key = `${entry.type}:${entry.name}`
    if (chain.includes(key)) {
      throw new RequiresCycleError([...chain, key])
    }
    if (visited.has(key)) return
    visited.add(key)
    for (const ref of entry.requires ?? []) {
      const parsed = parseRequireRef(ref)
      if (!parsed) continue
      const dep = byKey.get(`${parsed.category}:${parsed.name}`)
      if (!dep) continue
      visit(dep, [...chain, key])
    }
    out.push(entry)
  }

  for (const root of rootCandidates) visit(root, [])
  return out
}

// Expand `~/foo` → `<home>/foo` for status probes.
export const expandHome = (p: string, homeDir: string): string =>
  p.startsWith("~") ? `${homeDir}${p.slice(1)}` : p

// Coerce arbitrary id to a safe path segment (mirrors claude-config.core).
export const isSafeSegment = (id: string): boolean =>
  id.length > 0 &&
  !id.startsWith(".") &&
  !id.includes("/") &&
  !id.includes("\\") &&
  !id.includes("\0")

// --- Catalog document mutation -------------------------------------------------
//
// For `add` / `remove`, we need to update the on-disk YAML without losing
// comments, formatting, or key ordering. The plain `parse` we use elsewhere
// throws away that detail, so the mutation paths go through `yaml.Document`.
// These helpers stay pure: they take a Document, mutate it in place, and the
// repo layer is responsible for reading/writing the file.

export const parseCatalogDocument = (text: string): Document =>
  parseDocument(text === "" ? "library: {}\n" : text)

export const serializeCatalogDocument = (doc: Document): string => doc.toString()

const ensureLibraryMap = (doc: Document): YAMLMap => {
  const existing = doc.get("library")
  if (isMap(existing)) return existing
  const created = doc.createNode({}) as YAMLMap
  doc.set("library", created)
  return created
}

const ensureCategorySeq = (doc: Document, category: LibraryCategory): YAMLSeq => {
  const library = ensureLibraryMap(doc)
  const existing = library.get(category)
  if (isSeq(existing)) return existing
  const created = doc.createNode([]) as YAMLSeq
  library.set(category, created)
  return created
}

export class DuplicateEntryError extends Error {
  override readonly name = "DuplicateEntryError"
}

export const upsertEntryInDocument = (
  doc: Document,
  entry: LibraryEntry,
  mode: "add" | "upsert" = "add",
): void => {
  const seq = ensureCategorySeq(doc, entry.type)
  const existingIdx = (seq.items as unknown[]).findIndex((item) => {
    if (!isMap(item)) return false
    const name = item.get("name")
    return name === entry.name
  })
  const node = doc.createNode({
    name: entry.name,
    description: entry.description,
    source: entry.source,
    ...(entry.requires && entry.requires.length > 0 ? { requires: entry.requires } : {}),
  })
  if (existingIdx >= 0) {
    if (mode === "add") {
      throw new DuplicateEntryError(`${entry.type}:${entry.name} already in catalog`)
    }
    seq.set(existingIdx, node)
  } else {
    seq.add(node)
  }
}

export const removeEntryFromDocument = (
  doc: Document,
  name: string,
  type: LibraryCategory,
): boolean => {
  const library = doc.get("library")
  if (!isMap(library)) return false
  const seq = library.get(type)
  if (!isSeq(seq)) return false
  const idx = (seq.items as unknown[]).findIndex((item) => {
    if (!isMap(item)) return false
    return item.get("name") === name
  })
  if (idx < 0) return false
  seq.delete(idx)
  return true
}
