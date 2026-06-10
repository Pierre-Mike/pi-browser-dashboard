import { describe, expect, it } from "bun:test"
import { SPAWN_INTENT_INPUT, SPAWN_MODAL_SHELL, SPAWN_SKILLS_CONTAINER } from "./spawnModalLayout"

describe("spawnModalLayout", () => {
  it("makes the modal shell wide enough for many skill pills", () => {
    expect(SPAWN_MODAL_SHELL).toContain("max-w-3xl")
    expect(SPAWN_MODAL_SHELL).not.toContain("max-w-lg")
  })

  it("lets the skills list grow with the viewport instead of clipping at a fixed height", () => {
    expect(SPAWN_SKILLS_CONTAINER).toContain("max-h-[60vh]")
    expect(SPAWN_SKILLS_CONTAINER).not.toContain("max-h-32")
  })

  it("keeps the skills list scrollable when it overflows", () => {
    expect(SPAWN_SKILLS_CONTAINER).toContain("overflow-y-auto")
  })

  it("keeps skills wrapping across rows", () => {
    expect(SPAWN_SKILLS_CONTAINER).toContain("flex")
    expect(SPAWN_SKILLS_CONTAINER).toContain("flex-wrap")
  })

  // The modal portals into document.body, outside the themed root div, so it
  // must set its own readable text color in both light and dark mode.
  it("sets explicit text colors on the shell for light and dark mode", () => {
    expect(SPAWN_MODAL_SHELL).toContain("text-slate-900")
    expect(SPAWN_MODAL_SHELL).toContain("dark:text-slate-100")
  })

  it("keeps typed intent text readable on the dark textarea background", () => {
    expect(SPAWN_INTENT_INPUT).toContain("dark:bg-slate-950")
    expect(SPAWN_INTENT_INPUT).toContain("text-slate-900")
    expect(SPAWN_INTENT_INPUT).toContain("dark:text-slate-100")
  })

  it("keeps the placeholder visible but muted in both modes", () => {
    expect(SPAWN_INTENT_INPUT).toContain("placeholder:text-slate-400")
    expect(SPAWN_INTENT_INPUT).toContain("dark:placeholder:text-slate-500")
  })
})
