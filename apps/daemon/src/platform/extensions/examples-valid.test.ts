import { describe, expect, it } from "bun:test"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { parseManifest } from "./manifest"

// Repo root is 5 segments up from this file:
// apps/daemon/src/platform/extensions/examples-valid.test.ts
const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..", "..")
const EXAMPLES_DIR = join(REPO_ROOT, "examples", "extensions")

const exampleDirs = readdirSync(EXAMPLES_DIR).filter((name) =>
  statSync(join(EXAMPLES_DIR, name)).isDirectory(),
)

describe("examples/extensions are valid extensions", () => {
  it("ships at least the hello and repo-explorer examples", () => {
    expect(exampleDirs).toContain("hello")
    expect(exampleDirs).toContain("repo-explorer")
  })

  for (const name of exampleDirs) {
    describe(name, () => {
      const dir = join(EXAMPLES_DIR, name)

      it("has a manifest.json that passes parseManifest", () => {
        const raw = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"))
        const parsed = parseManifest(raw)
        expect(parsed.ok).toBe(true)
        if (parsed.ok) expect(parsed.value.name).toBe(name)
      })

      it("an iframe-tier example ships an index.html", () => {
        const raw = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"))
        const parsed = parseManifest(raw)
        if (parsed.ok && parsed.value.tier === "iframe") {
          expect(existsSync(join(dir, "index.html"))).toBe(true)
        }
      })
    })
  }
})
