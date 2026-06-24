import { describe, expect, it } from "bun:test"
import { type PidApp, pidAppSrc, pidAppsQueryKey } from "./pidApps"

describe("pidAppsQueryKey", () => {
  it("is project-scoped so apps never leak across projects", () => {
    expect(pidAppsQueryKey("projA")).toEqual(["pid-apps", "projA"])
    expect(pidAppsQueryKey("projB")).toEqual(["pid-apps", "projB"])
  })
})

describe("pidAppSrc", () => {
  it("targets the daemon serve route with a trailing slash (entry)", () => {
    expect(pidAppSrc("http://d", { projectId: "projA", appId: "default" })).toBe(
      "http://d/projects/projA/pid-apps/default/",
    )
  })

  it("preserves the /__api tunnel prefix in the base", () => {
    expect(pidAppSrc("https://x.example/__api", { projectId: "p", appId: "spec" })).toBe(
      "https://x.example/__api/projects/p/pid-apps/spec/",
    )
  })
})

describe("PidApp type", () => {
  it("carries id, label, and an optional icon", () => {
    const withIcon: PidApp = { id: "spec", label: "My Spec", icon: "📄" }
    expect(withIcon).toEqual({ id: "spec", label: "My Spec", icon: "📄" })
    const bare: PidApp = { id: "default", label: "default" }
    expect(bare.icon).toBeUndefined()
  })
})
