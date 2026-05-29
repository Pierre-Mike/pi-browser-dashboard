import { describe, expect, it } from "bun:test"
import { parseManifest } from "./manifest"
import { buildScaffold } from "./scaffold"

describe("buildScaffold", () => {
  describe("valid names", () => {
    it("returns ok:true with dirName equal to name", () => {
      const result = buildScaffold("my-ext")
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.dirName).toBe("my-ext")
    })

    it("includes manifest.json and index.html files", () => {
      const result = buildScaffold("hello")
      expect(result.ok).toBe(true)
      if (!result.ok) return
      const paths = result.files.map((f) => f.relPath)
      expect(paths).toContain("manifest.json")
      expect(paths).toContain("index.html")
      expect(result.files).toHaveLength(2)
    })

    it("manifest.json parses as valid JSON and passes parseManifest", () => {
      const result = buildScaffold("test-ext")
      expect(result.ok).toBe(true)
      if (!result.ok) return

      const manifestFile = result.files.find((f) => f.relPath === "manifest.json")
      expect(manifestFile).toBeDefined()
      if (!manifestFile) return

      let raw: unknown
      expect(() => {
        raw = JSON.parse(manifestFile.content)
      }).not.toThrow()

      const parsed = parseManifest(raw)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) return
      expect(parsed.value.name).toBe("test-ext")
      expect(parsed.value.version).toBe("0.0.1")
      expect(parsed.value.tier).toBe("iframe")
    })

    it("manifest.json contributes a tab with id=main and label=name", () => {
      const result = buildScaffold("my-tab")
      expect(result.ok).toBe(true)
      if (!result.ok) return

      const manifestFile = result.files.find((f) => f.relPath === "manifest.json")
      if (!manifestFile) return
      const raw = JSON.parse(manifestFile.content) as {
        contributes?: { tabs?: { id: string; label: string }[] }
      }
      expect(raw.contributes?.tabs).toHaveLength(1)
      expect(raw.contributes?.tabs?.[0]).toEqual({ id: "main", label: "my-tab" })
    })

    it("index.html contains a postMessage RPC call to parent", () => {
      const result = buildScaffold("hello")
      expect(result.ok).toBe(true)
      if (!result.ok) return

      const htmlFile = result.files.find((f) => f.relPath === "index.html")
      expect(htmlFile).toBeDefined()
      if (!htmlFile) return
      expect(htmlFile.content).toContain("parent.postMessage")
      expect(htmlFile.content).toContain("getContext")
    })

    it("index.html contains fs capability hint comment", () => {
      const result = buildScaffold("hello")
      expect(result.ok).toBe(true)
      if (!result.ok) return

      const htmlFile = result.files.find((f) => f.relPath === "index.html")
      if (!htmlFile) return
      expect(htmlFile.content).toContain("fs")
      expect(htmlFile.content).toContain("listFiles")
    })

    it("accepts names with dots and underscores", () => {
      expect(buildScaffold("my.ext_v2").ok).toBe(true)
      expect(buildScaffold("a").ok).toBe(true)
      expect(buildScaffold("ext-1.0").ok).toBe(true)
    })

    it("opts parameter is accepted without affecting core output", () => {
      const r1 = buildScaffold("hello", { tier: "iframe", scope: "global" })
      const r2 = buildScaffold("hello", { scope: "local" })
      expect(r1.ok).toBe(true)
      expect(r2.ok).toBe(true)
      if (!r1.ok || !r2.ok) return
      expect(r1.files.map((f) => f.relPath)).toEqual(r2.files.map((f) => f.relPath))
    })
  })

  describe("invalid names", () => {
    it("rejects an empty name", () => {
      const result = buildScaffold("")
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toBeTruthy()
    })

    it("rejects names with uppercase letters", () => {
      const result = buildScaffold("BadName")
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toContain("name")
    })

    it("rejects names with uppercase UPPER", () => {
      const result = buildScaffold("UPPER")
      expect(result.ok).toBe(false)
    })

    it("rejects names with forward slashes", () => {
      const result = buildScaffold("Bad/Name")
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toContain("name")
    })

    it("rejects dot-dot traversal", () => {
      const result = buildScaffold("..")
      expect(result.ok).toBe(false)
    })

    it("rejects names starting with a dash", () => {
      const result = buildScaffold("-bad")
      expect(result.ok).toBe(false)
    })

    it("rejects names starting with a dot", () => {
      const result = buildScaffold(".hidden")
      expect(result.ok).toBe(false)
    })

    it("rejects names with backslash", () => {
      const result = buildScaffold("back\\slash")
      expect(result.ok).toBe(false)
    })

    it("rejects names with spaces", () => {
      const result = buildScaffold("my ext")
      expect(result.ok).toBe(false)
    })
  })
})
