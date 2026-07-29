// Drift guard for the agent-facing document served at GET /agent-skill.md.
// A doc that silently rots is worse than no doc, so every claim it makes is
// checked here against the real source of truth rather than hand-copied:
// the named-key vocabulary, the state-slug list, the wait timeout constants,
// the Hono route table, and (for the pid exit-code table) AGENTS.md's own
// CLI section.
//
// Authority choice for the exit-code table: apps/cli's package.json declares
// no "exports" map and apps/daemon has no dependency on the `pid-dashboard`
// workspace package (it is the other way around — apps/cli depends on
// @pid/daemon), so a deep import of apps/cli/src/agent/agent.core from this
// workspace would be a reverse, undeclared cross-package dependency — the
// same kind of back-channel the "modular monolith" axiom rules out for
// feature slices. AGENTS.md's "### Exit codes" table is therefore read as
// the authority instead (still not hand-copied — the numbers below are
// parsed out of the file at test time, not retyped).

import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { app } from "../api"
import { KNOWN_STATES } from "../features/sessions/sessions.core"
import { NAMED_KEYS } from "../features/sessions/sessions-keys.core"
import {
  WAIT_TIMEOUT_DEFAULT_MS,
  WAIT_TIMEOUT_MAX_MS,
  WAIT_VIA_VALUES,
} from "../features/sessions/sessions-wait.core"
import { buildDiscovery } from "./agent-discovery.core"
import { AGENT_SKILL_MD } from "./agent-skill"

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..")

// The body of a markdown section: everything after `## <heading>` (or
// `### <heading>`) up to the next heading line of any level, exclusive.
const sectionBody = ({
  doc,
  heading,
}: {
  readonly doc: string
  readonly heading: string
}): string => {
  const marker = `\n${heading}\n`
  const start = doc.indexOf(marker)
  if (start === -1) throw new Error(`heading not found: ${heading}`)
  const rest = doc.slice(start + marker.length)
  const nextHeading = rest.search(/\n#{1,6} /)
  return nextHeading === -1 ? rest : rest.slice(0, nextHeading)
}

// Every lowercase/digit/hyphen/underscore token wrapped in single backticks
// on one markdown table row (a line starting with `|`) — `[]` for a prose
// line, which is what keeps this a vocabulary check rather than a scan of
// every backtick-quoted word in the surrounding prose (which also
// backtick-quotes unrelated field names like `wait` or `sequence`).
const backtickTokensInLine = (line: string): ReadonlyArray<string> => {
  if (!line.trim().startsWith("|")) return []
  return [...line.matchAll(/`([a-z0-9_-]+)`/g)]
    .map((m) => m[1])
    .filter((token): token is string => token !== undefined)
}

// Same check, applied to every table row in a section.
const backtickTokensInTableRows = (section: string): ReadonlySet<string> =>
  new Set(section.split("\n").flatMap(backtickTokensInLine))

describe("agent-skill.md: named key vocabulary", () => {
  it("documents exactly the real named-key vocabulary — no more, no less", () => {
    const section = sectionBody({ doc: AGENT_SKILL_MD, heading: "## Send and keys" })
    const documented = backtickTokensInTableRows(section)
    expect(documented).toEqual(new Set(NAMED_KEYS))
  })

  it("explains why ctrl-z and ctrl-c are excluded, without listing them as usable names", () => {
    expect(AGENT_SKILL_MD).toContain("ctrl-z")
    expect(AGENT_SKILL_MD).toContain("ctrl-c")
    const section = sectionBody({ doc: AGENT_SKILL_MD, heading: "## Send and keys" })
    const documented = backtickTokensInTableRows(section)
    expect(documented.has("ctrl-z")).toBe(false)
    expect(documented.has("ctrl-c")).toBe(false)
  })
})

describe("agent-skill.md: session state slugs", () => {
  it("documents exactly the real state-slug vocabulary — no more, no less", () => {
    const section = sectionBody({ doc: AGENT_SKILL_MD, heading: "## Session states" })
    const documented = backtickTokensInTableRows(section)
    expect(documented).toEqual(new Set(KNOWN_STATES))
  })
})

describe("agent-skill.md: wait constants", () => {
  it("quotes the real default and max timeout, in milliseconds", () => {
    expect(AGENT_SKILL_MD).toContain(String(WAIT_TIMEOUT_DEFAULT_MS))
    expect(AGENT_SKILL_MD).toContain(String(WAIT_TIMEOUT_MAX_MS))
  })

  // Same guard as the key/state vocabularies: a `via` this daemon does not
  // accept must not be advertised, and one it does accept must not be hidden.
  it("documents exactly the real via vocabulary — no more, no less", () => {
    const section = sectionBody({
      doc: AGENT_SKILL_MD,
      heading: "### Which observation settles it",
    })
    expect(backtickTokensInTableRows(section)).toEqual(new Set(WAIT_VIA_VALUES))
  })
})

describe("agent-skill.md: endpoints", () => {
  it("claims no endpoint the daemon does not actually serve", () => {
    const registered = new Set(app.routes.map((r) => `${r.method.toUpperCase()} ${r.path}`))
    const claimed = [...AGENT_SKILL_MD.matchAll(/`(GET|POST|PUT|DELETE|PATCH) (\/[^\s`]+)`/g)].map(
      (m) => `${m[1]} ${m[2]}`,
    )
    expect(claimed.length).toBeGreaterThan(0)
    for (const endpoint of claimed) {
      expect(registered.has(endpoint)).toBe(true)
    }
  })
})

// Discovery is worthless if the document names a variable the daemon does not
// set (an agent looks for it and finds nothing) or omits one it does set (the
// variable exists and nobody knows it). Both directions are drift, so the real
// env keys are the authority — same guard as the key/state vocabularies above.
// Same shape as backtickTokensInTableRows, for the SHOUTY_CASE env names that
// helper's lowercase vocabulary regex deliberately ignores.
const envNamesInTableRows = (section: string): ReadonlySet<string> =>
  new Set(
    section
      .split("\n")
      .filter((line) => line.trim().startsWith("|"))
      .flatMap((line) => [...line.matchAll(/`([A-Z][A-Z0-9_]+)`/g)])
      .map((m) => m[1])
      .filter((token): token is string => token !== undefined),
  )

describe("agent-skill.md: spawn-time discovery", () => {
  it("documents exactly the env vars a spawned session actually receives", () => {
    const { env } = buildDiscovery({
      baseUrl: "http://localhost:8787",
      apiPrefix: "",
      pidBin: "/tmp/pid",
      shimDir: "/tmp",
      withPointer: false,
    })
    const section = sectionBody({ doc: AGENT_SKILL_MD, heading: "## Finding this daemon" })
    expect(envNamesInTableRows(section)).toEqual(new Set(Object.keys(env)))
  })
})

// Parses one `| <code> | <meaning> |` row, or `undefined` for any other line
// (header, separator, prose) in the same section.
const exitCodeRow = (
  line: string,
): { readonly code: number; readonly meaning: string } | undefined => {
  const m = line.match(/^\|\s*(\d+)\s*\|(.+)\|\s*$/)
  if (m?.[1] === undefined || m[2] === undefined) return undefined
  return { code: Number(m[1]), meaning: m[2].trim() }
}

// Extracts { code, meaning } rows from a markdown table like
// "| 0 | success / wait satisfied |" within the given section.
const exitCodeRows = (section: string): ReadonlyMap<number, string> =>
  new Map(
    section
      .split("\n")
      .map(exitCodeRow)
      .filter(
        (row): row is { readonly code: number; readonly meaning: string } => row !== undefined,
      )
      .map((row) => [row.code, row.meaning] as const),
  )

describe("agent-skill.md: pid exit codes", () => {
  it("matches AGENTS.md's Exit codes table for every code", () => {
    const agentsMd = readFileSync(join(REPO_ROOT, "AGENTS.md"), "utf8")
    const authority = exitCodeRows(sectionBody({ doc: agentsMd, heading: "### Exit codes" }))
    const documented = exitCodeRows(sectionBody({ doc: AGENT_SKILL_MD, heading: "### Exit codes" }))
    expect(authority.size).toBeGreaterThan(0)
    expect(documented).toEqual(authority)
  })
})
