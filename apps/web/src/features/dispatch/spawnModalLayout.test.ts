import { describe, expect, it } from "bun:test"
import {
  SPAWN_INTENT_INPUT,
  SPAWN_MODAL_SHELL,
  SPAWN_SKILLS_CONTAINER,
  skillChipClass,
} from "./spawnModalLayout"

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

  it("never draws a horizontal scrollbar on the skills list", () => {
    expect(SPAWN_SKILLS_CONTAINER).toContain("overflow-x-hidden")
  })

  it("keeps skills wrapping across rows", () => {
    expect(SPAWN_SKILLS_CONTAINER).toContain("flex")
    expect(SPAWN_SKILLS_CONTAINER).toContain("flex-wrap")
  })

  // The modal portals into document.body, outside the themed root div, so it
  // must set its own readable text color via semantic token.
  it("sets semantic text color on the shell", () => {
    expect(SPAWN_MODAL_SHELL).toContain("text-base-content")
  })

  it("uses semantic background for the textarea", () => {
    expect(SPAWN_INTENT_INPUT).toContain("bg-base-100")
    expect(SPAWN_INTENT_INPUT).toContain("text-base-content")
  })

  it("keeps the placeholder visible but muted", () => {
    expect(SPAWN_INTENT_INPUT).toContain("placeholder:text-base-content/40")
  })

  describe("skillChipClass", () => {
    it("lets a long skill id wrap inside the pill instead of overflowing the row", () => {
      const cls = skillChipClass(false)
      expect(cls).toContain("max-w-full")
      expect(cls).toContain("shrink")
      expect(cls).toContain("break-all")
      expect(cls).toContain("whitespace-normal")
    })

    it("marks the selected chip as primary", () => {
      expect(skillChipClass(true)).toContain("btn-primary")
      expect(skillChipClass(true)).not.toContain("btn-ghost")
    })

    it("renders an unselected chip as a subtle ghost pill", () => {
      const cls = skillChipClass(false)
      expect(cls).toContain("btn-ghost")
      expect(cls).not.toContain("btn-primary")
    })
  })
})
