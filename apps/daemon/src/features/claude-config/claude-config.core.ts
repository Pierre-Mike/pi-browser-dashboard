// Pure parsers for Claude Code config (settings.json, skills, hooks).
// No I/O — file reads live in claude-config.repo.ts.

export type HookEvent =
  | "Stop"
  | "SubagentStop"
  | "Notification"
  | "PreToolUse"
  | "PostToolUse"
  | "UserPromptSubmit"
  | "PreCompact"
  | "SessionStart"
  | "SessionEnd"

export type HookEntry = {
  readonly event: string
  readonly matcher?: string
  readonly command: string
  readonly type?: string
  readonly timeout?: number
  readonly async?: boolean
  readonly statusMessage?: string
}

export type SettingsSummary = {
  readonly hooks: readonly HookEntry[]
  readonly permissions?: {
    readonly allow?: readonly string[]
    readonly deny?: readonly string[]
    readonly ask?: readonly string[]
    readonly defaultMode?: string
    readonly additionalDirectories?: readonly string[]
  }
  readonly theme?: string
  readonly statusLine?: unknown
  readonly enabledPlugins?: Record<string, unknown>
  readonly extras: Record<string, unknown>
  readonly raw: string
  readonly parseError?: string
}

export type SkillFrontmatter = {
  readonly name?: string
  readonly description?: string
  readonly metadata?: Record<string, unknown>
}

export type SkillSummary = {
  readonly id: string
  readonly path: string
  readonly name: string
  readonly description?: string
  readonly bytes: number
  readonly hasEvals: boolean
}

export type SkillDetail = SkillSummary & {
  readonly body: string
  readonly frontmatter: SkillFrontmatter
}

export type HookScript = {
  readonly name: string
  readonly path: string
  readonly bytes: number
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

// Flatten settings.json → hooks → { event: [{ matcher?, hooks: [...] }, ...] }
// into a flat array of HookEntry. Unknown shapes are skipped silently so a
// hand-edited settings.json can't crash the listing.
export const flattenHooks = (raw: unknown): readonly HookEntry[] => {
  if (!isObject(raw)) return []
  const out: HookEntry[] = []
  for (const [event, groupsRaw] of Object.entries(raw)) {
    if (!Array.isArray(groupsRaw)) continue
    for (const groupRaw of groupsRaw) {
      if (!isObject(groupRaw)) continue
      const matcher = typeof groupRaw.matcher === "string" ? groupRaw.matcher : undefined
      const hooksArr = groupRaw.hooks
      if (!Array.isArray(hooksArr)) continue
      for (const h of hooksArr) {
        if (!isObject(h)) continue
        const command = typeof h.command === "string" ? h.command : ""
        if (!command) continue
        const entry: HookEntry = {
          event,
          ...(matcher !== undefined ? { matcher } : {}),
          command,
          ...(typeof h.type === "string" ? { type: h.type } : {}),
          ...(typeof h.timeout === "number" ? { timeout: h.timeout } : {}),
          ...(typeof h.async === "boolean" ? { async: h.async } : {}),
          ...(typeof h.statusMessage === "string" ? { statusMessage: h.statusMessage } : {}),
        }
        out.push(entry)
      }
    }
  }
  return out
}

// Parse a settings.json text into a structured summary. On parse failure the
// raw text is preserved and parseError is set so the UI can still show the
// file contents with an inline error banner.
export const parseSettings = (text: string): SettingsSummary => {
  if (text.trim() === "") {
    return { hooks: [], extras: {}, raw: text }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    return {
      hooks: [],
      extras: {},
      raw: text,
      parseError: e instanceof Error ? e.message : "invalid JSON",
    }
  }
  if (!isObject(parsed)) {
    return { hooks: [], extras: {}, raw: text, parseError: "settings root is not an object" }
  }
  const hooks = flattenHooks(parsed.hooks)
  const permissionsRaw = parsed.permissions
  const permissions = isObject(permissionsRaw)
    ? {
        allow: Array.isArray(permissionsRaw.allow)
          ? (permissionsRaw.allow.filter((x) => typeof x === "string") as string[])
          : undefined,
        deny: Array.isArray(permissionsRaw.deny)
          ? (permissionsRaw.deny.filter((x) => typeof x === "string") as string[])
          : undefined,
        ask: Array.isArray(permissionsRaw.ask)
          ? (permissionsRaw.ask.filter((x) => typeof x === "string") as string[])
          : undefined,
        defaultMode:
          typeof permissionsRaw.defaultMode === "string" ? permissionsRaw.defaultMode : undefined,
        additionalDirectories: Array.isArray(permissionsRaw.additionalDirectories)
          ? (permissionsRaw.additionalDirectories.filter((x) => typeof x === "string") as string[])
          : undefined,
      }
    : undefined
  const knownKeys = new Set(["hooks", "permissions", "theme", "statusLine", "enabledPlugins"])
  const extras: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(parsed)) {
    if (!knownKeys.has(k)) extras[k] = v
  }
  return {
    hooks,
    ...(permissions ? { permissions } : {}),
    ...(typeof parsed.theme === "string" ? { theme: parsed.theme } : {}),
    ...(parsed.statusLine !== undefined ? { statusLine: parsed.statusLine } : {}),
    ...(isObject(parsed.enabledPlugins) ? { enabledPlugins: parsed.enabledPlugins } : {}),
    extras,
    raw: text,
  }
}

// Minimal YAML-ish frontmatter parser for SKILL.md. Supports flat key: value
// pairs and a `metadata:` block with one level of indented children. Anything
// fancier (nested arrays, multi-line strings) is left to the body — Claude
// Code's own loader is just as forgiving here.
export const parseSkillFrontmatter = (
  text: string,
): { readonly frontmatter: SkillFrontmatter; readonly body: string } => {
  if (!text.startsWith("---")) {
    return { frontmatter: {}, body: text }
  }
  const end = text.indexOf("\n---", 3)
  if (end === -1) return { frontmatter: {}, body: text }
  const block = text.slice(4, end).replace(/^\n/, "")
  // Find body start after closing --- and optional newline.
  const afterClose = end + 4
  const bodyStart = text[afterClose] === "\n" ? afterClose + 1 : afterClose
  const body = text.slice(bodyStart)

  const fm: { name?: string; description?: string; metadata?: Record<string, unknown> } = {}
  let inMetadata = false
  const metadata: Record<string, unknown> = {}
  for (const rawLine of block.split(/\r?\n/)) {
    if (rawLine.trim() === "") continue
    const indented = /^\s/.test(rawLine)
    if (!indented) {
      inMetadata = false
      const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(rawLine)
      if (!m) continue
      const key = m[1] ?? ""
      const value = (m[2] ?? "").trim()
      if (key === "metadata" && value === "") {
        inMetadata = true
        continue
      }
      if (key === "name") fm.name = unquote(value)
      else if (key === "description") fm.description = unquote(value)
    } else if (inMetadata) {
      const m = /^\s+([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(rawLine)
      if (!m) continue
      const key = m[1] ?? ""
      const value = (m[2] ?? "").trim()
      metadata[key] = unquote(value)
    }
  }
  if (Object.keys(metadata).length > 0) fm.metadata = metadata
  return { frontmatter: fm, body }
}

const unquote = (s: string): string => {
  if (
    s.length >= 2 &&
    ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))
  ) {
    return s.slice(1, -1)
  }
  return s
}

// Coerce an arbitrary id (dirname / filename) to a safe path segment.
export const isSafeSegment = (id: string): boolean =>
  id.length > 0 &&
  !id.startsWith(".") &&
  !id.includes("/") &&
  !id.includes("\\") &&
  !id.includes("\0")
