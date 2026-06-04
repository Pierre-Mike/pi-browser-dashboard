import { describe, expect, it } from "bun:test"
import { SPAWN_MODAL_SHELL, SPAWN_SKILLS_CONTAINER } from "./spawnModalLayout"

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
})
