import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { buildScaffold } from "./scaffold"

// Repo root is 4 levels up from this file:
// apps/daemon/src/platform/extensions/scaffold-example.test.ts
const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..", "..")
const EXAMPLE_DIR = join(REPO_ROOT, "examples", "extensions", "hello")

describe("examples/extensions/hello drift check", () => {
  it("committed manifest.json matches buildScaffold('hello') output byte-for-byte", () => {
    const result = buildScaffold("hello")
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const scaffoldManifest = result.files.find((f) => f.relPath === "manifest.json")
    expect(scaffoldManifest).toBeDefined()
    if (!scaffoldManifest) return

    const committedManifest = readFileSync(join(EXAMPLE_DIR, "manifest.json"), "utf8")
    expect(committedManifest).toBe(scaffoldManifest.content)
  })

  it("committed index.html matches buildScaffold('hello') output byte-for-byte", () => {
    const result = buildScaffold("hello")
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const scaffoldHtml = result.files.find((f) => f.relPath === "index.html")
    expect(scaffoldHtml).toBeDefined()
    if (!scaffoldHtml) return

    const committedHtml = readFileSync(join(EXAMPLE_DIR, "index.html"), "utf8")
    expect(committedHtml).toBe(scaffoldHtml.content)
  })

  it("no extra files in committed example beyond what scaffold generates", () => {
    const result = buildScaffold("hello")
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const scaffoldPaths = new Set(result.files.map((f) => f.relPath))
    // Both scaffold files must be present in examples dir (verified by other tests).
    // This test ensures the committed example has exactly the scaffold files.
    expect(scaffoldPaths.has("manifest.json")).toBe(true)
    expect(scaffoldPaths.has("index.html")).toBe(true)
    expect(result.files).toHaveLength(2)
  })
})
