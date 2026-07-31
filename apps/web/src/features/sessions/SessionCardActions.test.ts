import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parsePeekSummary } from "./SessionCardActions"

const src = readFileSync(join(import.meta.dir, "SessionCardActions.tsx"), "utf8")

describe("the action row on a small screen", () => {
  it("wraps instead of pushing the card past the viewport", () => {
    // Five controls plus the mono short id need ~470px on one line. On a 390px
    // phone that overflowed the *document* by 83px, so the whole page scrolled
    // sideways — measured in responsive-shell.spec.ts, which is what found it.
    const row = src.match(/className="flex[^"]*pt-1[^"]*"/)
    expect(row).not.toBeNull()
    expect(row?.[0]).toContain("flex-wrap")
  })

  it("gates hover-to-reveal on the pointer, not on the viewport width", () => {
    // These are the card's primary controls (Kill, Delete, Send). Hiding them
    // until hover is right for a mouse and wrong for a finger — and `md:` asks
    // the wrong question: an iPad is 820px wide *and* has no hover, so every
    // tablet got a card whose actions were invisible with no way to reveal them.
    expect(src).toContain("pointer-fine:opacity-0")
    expect(src).toContain("pointer-fine:group-hover:opacity-100")
    expect(src).toContain("pointer-fine:group-focus-within:opacity-100")
    expect(src).not.toContain("md:opacity-0")
  })
})

describe("the copy control's label", () => {
  it("says what it does — copy a CLI command, not open the session", () => {
    // The label used to be a bare Open ↗, which on a card whose body is the way
    // *into* the session reads as the open control and silently writes to the
    // clipboard instead. The drill-in topbar already names the same action this
    // way, so the two surfaces now agree.
    expect(src).toContain("Open in CLI ↗")
    expect(src).not.toMatch(/"Open ↗"/)
  })
})

describe("parsePeekSummary", () => {
  it("extracts a string summary", () => {
    expect(parsePeekSummary({ summary: "Reading the transcript…" })).toBe("Reading the transcript…")
  })

  it("returns undefined when summary is missing, wrong-typed, or the body isn't an object", () => {
    expect(parsePeekSummary({})).toBeUndefined()
    expect(parsePeekSummary({ summary: 1 })).toBeUndefined()
    expect(parsePeekSummary(null)).toBeUndefined()
    expect(parsePeekSummary("done")).toBeUndefined()
  })
})
