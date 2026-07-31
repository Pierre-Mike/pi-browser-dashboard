import { describe, expect, it } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { THEME_FAMILIES } from "./lib/ui/theme.core"

// Static consistency guard for the published feature-tour page
// (doc/demo/index.html, served via GitHub Pages — see .github/workflows/pages.yml).
//
// The page is a hand-authored standalone HTML file: its STORIES data is inlined
// so the page needs no build step. That hand-authoring is exactly what rots —
// a capture gets re-recorded under a new name, a feature is added to the rig
// but not the page, or a story loses the narrative copy that makes it a *user
// story* rather than a bare feature list. Nothing else checks this, so this
// guard does:
//   1. every capture on disk appears on the page, and every reference resolves;
//   2. every story carries a non-empty narrative `scenario`;
//   3. an end-to-end walkthrough chains the features into one workflow.
//
// Each feature now ships **two** artifacts — a still the card paints immediately
// and a clip it fetches on hover — so a card can fail two ways the old
// gif-only check could not see: a missing still renders an empty box on first
// paint, and a still with no clip is a card that never animates. Both directions
// are asserted below, per artifact.
const REPO_ROOT = join(import.meta.dir, "..", "..", "..")
const DEMO_DIR = join(REPO_ROOT, "doc", "demo")
const html = readFileSync(join(DEMO_DIR, "index.html"), "utf8")
const onDisk = (dir: string, ext: string): ReadonlySet<string> =>
  new Set(
    readdirSync(join(DEMO_DIR, dir))
      .filter((f) => f.endsWith(ext))
      .map((f) => f.slice(0, -ext.length)),
  )

const gifsOnDisk = onDisk("gifs", ".gif")
const shotsOnDisk = onDisk("shots", ".webp")
const themesOnDisk = onDisk("themes", ".webp")

// Every `gif: "NN-slug"` referenced by the inlined STORIES data. These are the
// *feature cards*; a clip used as section furniture (the theme-cycle hero) is
// referenced by literal path instead and is collected separately.
const cardIds = [...html.matchAll(/gif:\s*"([^"]+)"/g)].map((m) => m[1] ?? "")
// `${GIFDIR}` / `${SHOTDIR}`, not a bare `gifs/` path: the page builds every URL
// from those two constants, so matching the literal directory name would find
// nothing and the check would pass by never looking at anything.
const literalGifs = [...html.matchAll(/\$\{GIFDIR\}([\w-]+)\.gif/g)].map((m) => m[1] ?? "")
const literalShots = [...html.matchAll(/\$\{SHOTDIR\}([\w-]+)\.webp/g)].map((m) => m[1] ?? "")
const storyIds = new Set([...html.matchAll(/id:\s*"(story-[\w-]+)"/g)].map((m) => m[1]))
const kickers = [...html.matchAll(/kicker:\s*"/g)].length

describe("demo feature-tour page stays consistent with the captures", () => {
  it("references every recorded clip exactly once, and every reference resolves", () => {
    const referenced = new Set([...cardIds, ...literalGifs])
    // No feature is carded twice.
    expect(cardIds.length).toBe(new Set(cardIds).size)
    // Bidirectional coverage: page ⇄ gifs/ directory.
    for (const name of gifsOnDisk) expect(referenced.has(name)).toBe(true)
    for (const name of referenced) expect(gifsOnDisk.has(name)).toBe(true)
  })

  it("every feature card has both a still and a clip", () => {
    // The card paints `shots/<id>.webp` and only fetches `gifs/<id>.gif` on hover,
    // so a missing still is an empty box that no clip-only check would catch.
    for (const id of cardIds) {
      expect(shotsOnDisk.has(id)).toBe(true)
      expect(gifsOnDisk.has(id)).toBe(true)
    }
    // …and nothing captured is left off the page. A still referenced by literal
    // path (the theme-lab panel) counts as used.
    const usedShots = new Set([...cardIds, ...literalShots])
    for (const name of shotsOnDisk) expect(usedShots.has(name)).toBe(true)
  })

  it("the theme gallery covers the whole catalog, in both variants", () => {
    // The page keeps its own FAMILIES list so it can render without a build step.
    // That is a mirror of `THEME_FAMILIES`, so it gets an assertion rather than an
    // apology: a tenth family added to the catalog and not to the page would
    // otherwise just be missing from the gallery, silently.
    const pageFamilies = [...html.matchAll(/\{\s*id:\s*"([a-z]+)",\s*name:\s*"/g)].map((m) => m[1])
    expect(pageFamilies).toEqual(THEME_FAMILIES.map((f) => f.id))

    // Three files per family, and no orphans in either direction.
    const wanted = new Set(
      THEME_FAMILIES.flatMap((f) => [`${f.id}-light`, `${f.id}-dark`, `${f.id}-lab`]),
    )
    for (const name of wanted) expect(themesOnDisk.has(name)).toBe(true)
    for (const name of themesOnDisk) expect(wanted.has(name)).toBe(true)
  })

  it("every story has a non-empty narrative scenario", () => {
    const scenarios = [...html.matchAll(/scenario:\s*"([^"]+)"/g)].map((m) => m[1] ?? "")
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
    // Every walkthrough step must target a story that actually exists. The id
    // pattern is deliberately not `story-\d+`: the themes story is `story-themes`,
    // and a digits-only pattern would skip validating the one step most likely to
    // be wrong — the newest.
    for (const m of html.matchAll(/\bto:\s*"(story-[\w-]+)"/g))
      expect(storyIds.has(m[1])).toBe(true)
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
    // The fallbacks are what a reader sees before the script runs, so they have to
    // agree with what the script computes: cards for features, and one story per
    // kicker — the themes section included, which is why it carries the same keys.
    expect(html).toContain(`id="statFeatures">${cardIds.length}<`)
    expect(html).toContain(`id="statStories">${kickers}<`)
  })
})
