import { describe, expect, it } from "bun:test"
import { prDiffOutcome } from "./github.core"

describe("prDiffOutcome", () => {
  it("returns stdout as the diff on success", () => {
    expect(prDiffOutcome({ stdout: "diff --git a/x b/x\n", stderr: "", exitCode: 0 })).toEqual({
      diff: "diff --git a/x b/x\n",
    })
  })

  it("surfaces stderr as a warning and an empty diff on failure", () => {
    expect(prDiffOutcome({ stdout: "", stderr: "no pull requests found", exitCode: 1 })).toEqual({
      diff: "",
      warning: "no pull requests found",
    })
  })

  it("synthesises a warning when a failure carries no stderr", () => {
    expect(prDiffOutcome({ stdout: "", stderr: "  ", exitCode: 2 })).toEqual({
      diff: "",
      warning: "gh pr diff exited 2",
    })
  })
})
