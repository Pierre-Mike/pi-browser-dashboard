// Pure discovery + manifest parsing for per-project pid-apps (HTML dropped into
// <project>/.pid/). No I/O — filesystem reads/streaming live in pid-apps.repo.ts.
//
// A pid-app is a static HTML site surfaced as a sandboxed, project-scoped
// extension tab. Discovery is zero-config: presence of an index.html is enough,
// no manifest required. An optional pid-app.json may override presentation only.

import { NAME_RE } from "../../platform/extensions/manifest"

// One app served either from <project>/.pid/ or from a top-level
// <project>/specs/*.html file. `root` is the app's directory RELATIVE to its
// source: for a "pid" app, "" for the implicit bare-root "default" app or
// "<id>" for a subdir app; for a "specs" app, always the literal "specs" (a
// spec is a single flat file, not a directory). `entry` is the HTML file
// served for the bare "/<appId>/" request. `source` records which of the two
// discovery roots produced this app — used only to resolve id collisions
// (".pid/" always wins); it carries no other behavior difference.
export type PidApp = {
  readonly id: string
  readonly label: string
  readonly entry: string
  readonly root: string
  readonly source: "pid" | "specs"
  readonly icon?: string
}

// One immediate child of <project>/.pid/, pre-probed (in the repo) for an
// index.html so discovery stays pure.
export type PidAppDirEntry = {
  readonly name: string
  readonly isDir: boolean
  readonly hasIndexHtml: boolean
}

// Optional <app>/pid-app.json — presentation/entry overrides only, never
// security. Every field is optional; absent/invalid fields fall back to the
// zero-config defaults.
export type PidAppManifest = {
  readonly title?: string
  readonly entry?: string
  readonly icon?: string
}

export const DEFAULT_APP_ID = "default"
export const DEFAULT_ENTRY = "index.html"

// Names under .pid/ that are pid internals and must never be surfaced as apps:
// `extensions` is the manifest-extension dir, the two JSON files are pid
// state/settings. `default` is reserved as a DIR name so a physical
// .pid/default/ cannot shadow the implicit bare-root default app.
export const RESERVED_PID_ENTRIES: ReadonlySet<string> = new Set([
  "extensions",
  "extensions-state.json",
  "settings.json",
  DEFAULT_APP_ID,
])

// Content-Security-Policy applied to EVERY served pid-app response (entry HTML
// and every sub-resource). The HTML is untrusted — anyone can drop it — so the
// iframe is already opaque-origin (sandbox="allow-scripts", no
// allow-same-origin). 'unsafe-inline' is required because self-contained HTML
// (e.g. planf3 plans) inlines its own <script>/<style> and dropped HTML cannot
// carry nonces; the bound on that is `connect-src 'none'` (no exfiltration) plus
// the opaque origin. Do NOT add a host to default-src or relax connect-src
// without understanding this tradeoff.
export const PID_APP_CSP =
  "default-src 'none'; img-src data: 'self'; style-src 'unsafe-inline' 'self'; " +
  "script-src 'unsafe-inline' 'self'; font-src data: 'self'; connect-src 'none'"

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

// Parse JSON text into a plain object, or null for nullish / malformed /
// non-object input. Never throws.
const parseJsonObject = (text: string | null | undefined): Record<string, unknown> | null => {
  if (text == null) return null
  try {
    const raw: unknown = JSON.parse(text)
    return isRecord(raw) ? raw : null
  } catch {
    return null
  }
}

// A trimmed, non-empty string, or undefined.
const nonEmptyString = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? v : undefined

// An entry override must name a single HTML file directly inside the app root.
// Restricting to *.html/*.htm blocks serving a script-capable type (e.g. a .svg
// with <script>) as the ENTRY document, which would run outside the HTML CSP.
// Sub-resources of any type are still served; only the entry is constrained.
const isValidEntry = (entry: string): boolean =>
  /^[^/\\]+\.html?$/.test(entry) && !entry.includes("..")

// A valid entry string from arbitrary input, or undefined.
const validEntry = (v: unknown): string | undefined => {
  const s = nonEmptyString(v)
  return s !== undefined && isValidEntry(s) ? s : undefined
}

// One optional manifest field as a spreadable partial — keeps the parser itself
// branch-free (and under the complexity gate).
const field = (key: keyof PidAppManifest, value: string | undefined): PidAppManifest =>
  value === undefined ? {} : ({ [key]: value } as PidAppManifest)

// Tolerant parser: never throws. Malformed JSON, a non-object, or wrong-typed
// fields degrade field-by-field to "absent" so the zero-config defaults win.
// Mirrors parsePidSettings.
export const parsePidAppManifest = (text: string | null | undefined): PidAppManifest => {
  const raw = parseJsonObject(text)
  if (!raw) return {}
  return {
    ...field("title", nonEmptyString(raw.title)),
    ...field("icon", nonEmptyString(raw.icon)),
    ...field("entry", validEntry(raw.entry)),
  }
}

// Apply a parsed manifest's presentation overrides over a discovered app.
// Security-relevant fields (id, root) are never touched.
export const applyPidAppManifest = (app: PidApp, manifest: PidAppManifest): PidApp => {
  const out: PidApp = {
    ...app,
    label: manifest.title ?? app.label,
    entry: manifest.entry ?? app.entry,
  }
  return manifest.icon !== undefined ? { ...out, icon: manifest.icon } : out
}

// Pure discovery. Given the immediate entries of <project>/.pid/ (each pre-probed
// for an index.html) and whether .pid/index.html itself exists, return the apps:
//   - a bare .pid/index.html        -> the implicit "default" app (root "")
//   - each subdir with an index.html, a valid name, and a non-reserved name -> an app
// Deterministic order: "default" first, then subdir apps alphabetical by id.
export const discoverPidApps = (
  entries: readonly PidAppDirEntry[],
  hasRootIndex: boolean,
): readonly PidApp[] => {
  const apps: PidApp[] = []
  if (hasRootIndex) {
    apps.push({
      id: DEFAULT_APP_ID,
      label: DEFAULT_APP_ID,
      entry: DEFAULT_ENTRY,
      root: "",
      source: "pid",
    })
  }
  const dirApps = entries
    .filter(
      (e) => e.isDir && e.hasIndexHtml && !RESERVED_PID_ENTRIES.has(e.name) && NAME_RE.test(e.name),
    )
    .map(
      (e): PidApp => ({
        id: e.name,
        label: e.name,
        entry: DEFAULT_ENTRY,
        root: e.name,
        source: "pid",
      }),
    )
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return [...apps, ...dirApps]
}

// Pure discovery of top-level <project>/specs/*.html(.htm) files as spec-sourced
// pid-apps. A spec is a single flat file: `root` is always the literal "specs"
// (there is no per-app subdirectory) and `entry` is the filename itself. Same
// tolerance as discoverPidApps: a basename that fails NAME_RE is silently
// skipped, never thrown — untrusted/arbitrary filenames must never crash
// discovery. Deterministic order: alphabetical by id.
export const discoverSpecApps = (filenames: readonly string[]): readonly PidApp[] =>
  filenames
    .filter((f) => /\.html?$/.test(f))
    .map((f) => ({ id: f.replace(/\.html?$/, ""), entry: f }))
    .filter((f) => NAME_RE.test(f.id))
    .map((f): PidApp => ({ id: f.id, label: f.id, entry: f.entry, root: "specs", source: "specs" }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

// Merge .pid/-sourced and specs/-sourced apps into the single list a project
// exposes. An id collision is resolved in favor of the .pid/ entry (dropping
// the specs one) — this mirrors the existing precedent that the bare-root
// "default" app wins over a same-named subdir: locked behavior, not
// underdetermined. Order: pidApps first (their existing order), then the
// remaining, non-colliding specApps (already alphabetical).
export const mergeAppSources = (
  pidApps: readonly PidApp[],
  specApps: readonly PidApp[],
): readonly PidApp[] => {
  const pidIds = new Set(pidApps.map((a) => a.id))
  return [...pidApps, ...specApps.filter((a) => !pidIds.has(a.id))]
}

// Maps an appId to its directory RELATIVE to .pid/: the bare-root "default" app
// is the .pid dir itself (""), every other app is its own subdir.
export const appRootFor = (appId: string): string => (appId === DEFAULT_APP_ID ? "" : appId)

// Guard for the SERVE route: an appId is servable iff it is the literal default
// app or a valid, non-reserved identifier. Enforced independently of discovery so
// a direct request for a reserved name (e.g. "extensions") cannot leak internals.
export const isValidAppId = (appId: string): boolean =>
  appId === DEFAULT_APP_ID || (!RESERVED_PID_ENTRIES.has(appId) && NAME_RE.test(appId))

// For the bare-root "default" app (whose root is the entire .pid dir), refuse any
// asset whose top path segment is a reserved pid internal, so .pid/settings.json,
// .pid/extensions/*, etc. can never be served through the default app.
export const isReservedDefaultAsset = (relPath: string): boolean =>
  RESERVED_PID_ENTRIES.has(relPath.split(/[/\\]/)[0] ?? "")

// Guard for the CREATE route: a new app's directory name must be a valid,
// non-reserved identifier — the same rule as isValidAppId minus the literal
// "default" carve-out (creating a subdir literally named "default" would only
// ever be shadowed by the bare-root app, so it's not a useful name to create).
export const isCreatableAppName = (name: string): boolean =>
  NAME_RE.test(name) && !RESERVED_PID_ENTRIES.has(name)

// Starter HTML written for a newly created pid-app. Deliberately inert: no
// <script>/postMessage — pid-apps stay capability-free (that RPC pattern
// belongs exclusively to the separate extension-platform scaffold). `name` is
// validated by isCreatableAppName (NAME_RE: [a-z0-9][a-z0-9._-]*) before this
// ever runs, so it can never carry markup and needs no HTML-escaping here.
export const buildStarterHtml = (name: string): string =>
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${name}</title>
  </head>
  <body>
    <h1>${name}</h1>
    <p>Edit .pid/${name}/index.html to build this app.</p>
  </body>
</html>
`
