import { describe, expect, it } from "bun:test"
import { gatesFromVerify, gatesOf, isSelfReferential } from "./gates.core"

describe("gatesFromVerify", () => {
  it("reads the gate chain out of the verify script, in order", () => {
    expect(
      gatesFromVerify({
        verifyScript:
          "bun run lint:ci && bun run typecheck && bun run test && bun run test:web && bun run test:cli && bun run audit && bun run axiom-debt",
      }),
    ).toEqual(["lint:ci", "typecheck", "test", "test:web", "test:cli", "audit", "axiom-debt"])
  })

  it("dedupes and falls back when verify is missing", () => {
    expect(gatesFromVerify({ verifyScript: "bun run test && bun run test" })).toEqual(["test"])
    expect(gatesFromVerify({ verifyScript: undefined, fallback: ["test"] })).toEqual(["test"])
    expect(gatesFromVerify({ verifyScript: "echo nothing", fallback: ["test"] })).toEqual(["test"])
    expect(gatesFromVerify({ verifyScript: undefined })).toEqual([])
  })
})

describe("gatesOf", () => {
  it("keeps only steps that are real scripts", () => {
    expect(
      gatesOf({
        scripts: { verify: "bun run lint:ci && bun run ghost", "lint:ci": "biome ci ." },
      }),
    ).toEqual(["lint:ci"])
  })

  it("never runs verify as a gate — it would collapse the whole jury into one bit", () => {
    expect(isSelfReferential("verify")).toBe(true)
    expect(
      gatesOf({ scripts: { verify: "bun run verify && bun run test", test: "bun test" } }),
    ).toEqual(["test"])
  })

  it("picks up a gate added to verify with no change here", () => {
    // The point of deriving: this is the drift a hardcoded list would miss.
    expect(
      gatesOf({
        scripts: {
          verify: "bun run test && bun run brand-new-gate",
          test: "bun test",
          "brand-new-gate": "bun run scripts/new.ts",
        },
      }),
    ).toEqual(["test", "brand-new-gate"])
  })
})
