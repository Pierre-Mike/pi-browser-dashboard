import { describe, expect, it } from "bun:test"
import {
  parseAgenticListing,
  parseCatalogBundle,
  parseCommitShaWrapper,
  parseEntryWrapper,
  parseErrorBody,
  parseInitResult,
  parseInstallResult,
  parseOutcomesWrapper,
  parseRemovedWrapper,
} from "./library.parse"
import type { CatalogBundle } from "./types"
import { LIBRARY_CATEGORIES } from "./types"

const scopeDirs = { default: "/lib/skills", global: "/lib/global/skills" }

const catalogBundle: CatalogBundle = {
  catalog: {
    defaultDirs: Object.fromEntries(
      LIBRARY_CATEGORIES.map((c) => [c, scopeDirs]),
    ) as CatalogBundle["catalog"]["defaultDirs"],
    entries: [{ name: "editor", type: "skills", description: "edits text", source: "builtin" }],
  },
  catalogPath: "/lib/catalog.json",
  statusByName: { editor: { global: "installed", local: "not_installed" } },
}

describe("parseCatalogBundle", () => {
  it("accepts a well-formed bundle", () => {
    expect(parseCatalogBundle(catalogBundle)).toEqual(catalogBundle)
  })

  it("rejects a defaultDirs missing one of the six categories", () => {
    const { extensions, ...incomplete } = catalogBundle.catalog.defaultDirs
    expect(
      parseCatalogBundle({
        ...catalogBundle,
        catalog: { ...catalogBundle.catalog, defaultDirs: incomplete },
      }),
    ).toBeNull()
  })

  it("rejects an unrecognized install status", () => {
    expect(
      parseCatalogBundle({
        ...catalogBundle,
        statusByName: { editor: { global: "pending", local: "not_installed" } },
      }),
    ).toBeNull()
  })

  it("rejects a non-object", () => {
    expect(parseCatalogBundle(null)).toBeNull()
  })
})

describe("parseAgenticListing", () => {
  it("accepts a well-formed listing", () => {
    const listing = {
      repoPath: "/lib/agentic",
      category: "agents" as const,
      items: [{ name: "researcher", path: "agents/researcher", registered: true }],
    }
    expect(parseAgenticListing(listing)).toEqual(listing)
  })

  it("rejects an unrecognized category", () => {
    expect(parseAgenticListing({ repoPath: "/x", category: "widgets", items: [] })).toBeNull()
  })
})

describe("wrapper decoders", () => {
  it("parseInitResult accepts { catalogPath }", () => {
    expect(parseInitResult({ catalogPath: "/lib/catalog.json" })).toEqual({
      catalogPath: "/lib/catalog.json",
    })
  })

  it("parseInstallResult accepts { installed, destinations }", () => {
    const r = { installed: ["editor"], destinations: ["/proj/.claude/skills/editor"] }
    expect(parseInstallResult(r)).toEqual(r)
  })

  it("parseEntryWrapper accepts { entry }", () => {
    const entry = { name: "editor", type: "skills" as const, description: "d", source: "builtin" }
    expect(parseEntryWrapper({ entry })).toEqual({ entry })
  })

  it("parseCommitShaWrapper accepts { commitSha }", () => {
    expect(parseCommitShaWrapper({ commitSha: "abc123" })).toEqual({ commitSha: "abc123" })
  })

  it("parseRemovedWrapper accepts { removed }", () => {
    expect(parseRemovedWrapper({ removed: true })).toEqual({ removed: true })
  })

  it("parseOutcomesWrapper accepts { outcomes }", () => {
    const outcomes = [
      { name: "editor", type: "skills" as const, scope: "local" as const, ok: true },
    ]
    expect(parseOutcomesWrapper({ outcomes })).toEqual({ outcomes })
  })

  it("every wrapper rejects a malformed body", () => {
    expect(parseInitResult({})).toBeNull()
    expect(parseInstallResult({ installed: ["editor"] })).toBeNull()
    expect(parseEntryWrapper({ entry: { name: "editor" } })).toBeNull()
    expect(parseCommitShaWrapper({})).toBeNull()
    expect(parseRemovedWrapper({ removed: "yes" })).toBeNull()
    expect(parseOutcomesWrapper({ outcomes: [{ name: "editor" }] })).toBeNull()
  })
})

describe("parseErrorBody", () => {
  it("extracts error and message when both are strings", () => {
    expect(parseErrorBody({ error: "not_found", message: "no such entry" })).toEqual({
      error: "not_found",
      message: "no such entry",
    })
  })

  it("returns an empty object for a non-object or missing fields", () => {
    expect(parseErrorBody(null)).toEqual({ error: undefined, message: undefined })
    expect(parseErrorBody({})).toEqual({ error: undefined, message: undefined })
  })
})
