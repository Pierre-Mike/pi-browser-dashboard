// Pure discovery + manifest parsing for per-project pid-apps (HTML dropped into
// <project>/.pid/). No I/O — filesystem reads/streaming live in pid-apps.repo.ts.
//
// A pid-app is a static HTML site surfaced as a sandboxed, project-scoped
// extension tab. Discovery is zero-config: presence of an index.html is enough,
// no manifest required. An optional pid-app.json may override presentation only.

import { NAME_RE } from "../../platform/extensions/manifest"

// One app served from <project>/.pid/. `root` is the app's directory RELATIVE to
// the .pid dir: "" for the implicit bare-root "default" app, "<id>" for a subdir
// app. `entry` is the HTML file served for the bare "/<appId>/" request.
export type PidApp = {
  readonly id: string
  readonly label: string
  readonly entry: string
  readonly root: string
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
    apps.push({ id: DEFAULT_APP_ID, label: DEFAULT_APP_ID, entry: DEFAULT_ENTRY, root: "" })
  }
  const dirApps = entries
    .filter(
      (e) => e.isDir && e.hasIndexHtml && !RESERVED_PID_ENTRIES.has(e.name) && NAME_RE.test(e.name),
    )
    .map((e): PidApp => ({ id: e.name, label: e.name, entry: DEFAULT_ENTRY, root: e.name }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return [...apps, ...dirApps]
}
