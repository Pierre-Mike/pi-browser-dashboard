import { describe, expect, it } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

// Static consistency guard for the published feature-tour page
// (doc/demo/index.html, served via GitHub Pages — see .github/workflows/pages.yml).
//
// The page is a hand-authored standalone HTML file: its STORIES data is inlined
// so the page needs no build step. That hand-authoring is exactly what rots —
// a GIF gets re-recorded under a new name, a feature is added to the recorder
// but not the page, or a story loses the narrative copy that makes it a *user
// story* rather than a bare feature list. Nothing else checks this, so this
// guard does:
//   1. every recorded GIF appears on the page, and every <img> points at a real GIF;
//   2. every story carries a non-empty narrative `scenario` (the prose that
//      turns a feature group into a story);
//   3. an end-to-end walkthrough chains the features into one workflow.
const REPO_ROOT = join(import.meta.dir, "..", "..", "..")
const DEMO_DIR = join(REPO_ROOT, "doc", "demo")
const html = readFileSync(join(DEMO_DIR, "index.html"), "utf8")
const gifFiles = readdirSync(join(DEMO_DIR, "gifs")).filter((f) => f.endsWith(".gif"))

// Every `gif: "NN-slug"` referenced by the inlined STORIES data.
const referencedGifs = [...html.matchAll(/gif:\s*"([^"]+)"/g)].map((m) => m[1])

describe("demo feature-tour page stays consistent with the recordings", () => {
  it("references every recorded GIF exactly once", () => {
    const referenced = new Set(referencedGifs)
    const onDisk = new Set(gifFiles.map((f) => f.replace(/\.gif$/, "")))
    // No duplicates in the page.
    expect(referencedGifs.length).toBe(referenced.size)
    // Bidirectional coverage: page ⇄ gifs/ directory.
    for (const name of onDisk) expect(referenced.has(name)).toBe(true)
    for (const name of referenced) expect(onDisk.has(name)).toBe(true)
  })

  it("every story has a non-empty narrative scenario", () => {
    const kickers = [...html.matchAll(/kicker:\s*"/g)].length
    const scenarios = [...html.matchAll(/scenario:\s*"([^"]+)"/g)].map((m) => m[1])
    expect(kickers).toBeGreaterThanOrEqual(6)
    // One scenario per story…
    expect(scenarios.length).toBe(kickers)
    // …and each reads like a sentence, not a stub.
    for (const s of scenarios) expect(s.length).toBeGreaterThanOrEqual(60)
  })

  it("chains the features into an end-to-end walkthrough", () => {
    expect(html).toContain('id="walkthrough"')
    // The walkthrough is rendered from the inlined WALK array — each entry is a
    // step that links back to a story (`to: "story-N"`). Count the data, not the
    // runtime-rendered DOM.
    const steps = [...html.matchAll(/\bto:\s*"story-/g)].length
    expect(steps).toBeGreaterThanOrEqual(6)
    // Every walkthrough step must target a story that actually exists.
    const storyIds = new Set([...html.matchAll(/id:\s*"(story-\d+)"/g)].map((m) => m[1]))
    for (const m of html.matchAll(/\bto:\s*"(story-\d+)"/g)) expect(storyIds.has(m[1])).toBe(true)
  })

  it("the inlined render script parses as valid JS", () => {
    // The whole tour is generated at runtime by the inlined <script>. A syntax
    // error there (e.g. a stray backslash outside a string) silently blanks the
    // page — every section renders empty, so "I don't see any feature". The
    // data-consistency checks above all pass on a page that never renders.
    const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)?.[1]
    expect(script).toBeTruthy()
    expect(() => new Function(script as string)).not.toThrow()
  })

  it("hero stat fallbacks match the data", () => {
    const features = referencedGifs.length
    const stories = [...html.matchAll(/kicker:\s*"/g)].length
    expect(html).toContain(`id="statFeatures">${features}<`)
    expect(html).toContain(`id="statStories">${stories}<`)
  })
})
