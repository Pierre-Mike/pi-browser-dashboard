import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { pidAppsQueryKey } from "./pidApps"

// The hook's runtime is covered by Playwright e2e; here we pin its query key and
// the endpoint it calls at the source level (repo's src-text test convention).
const src = readFileSync(join(import.meta.dir, "usePidApps.ts"), "utf8")

describe("usePidApps", () => {
  it("keys the query per project", () => {
    expect(pidAppsQueryKey("p")).toEqual(["pid-apps", "p"])
    expect(src).toContain("queryKey: pidAppsQueryKey(projectId)")
  })

  it("fetches the project-scoped pid-apps endpoint", () => {
    expect(src).toContain("projects[projectId]")
    expect(src).toContain('["pid-apps"].$get()')
  })

  it("uses a short staleTime so freshly dropped apps appear soon", () => {
    expect(src).toContain("staleTime: 5_000")
  })
})

describe("useCreatePidApp", () => {
  it("posts the new app name to the project-scoped endpoint", () => {
    expect(src).toContain("useCreatePidApp")
    expect(src).toContain('["pid-apps"].$post({ json: { name } })')
  })

  it("invalidates the project's pid-apps query on success", () => {
    expect(src).toContain("qc.invalidateQueries({ queryKey: pidAppsQueryKey(projectId) })")
  })
})
