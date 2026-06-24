import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// The component's runtime is covered by Playwright e2e; here we lock its
// security invariants at the source level (repo's src-text test convention).
const src = readFileSync(join(import.meta.dir, "PidAppHost.tsx"), "utf8")

describe("PidAppHost source invariants", () => {
  it("sandboxes the iframe with allow-scripts only (no same-origin escape)", () => {
    expect(src).toContain('sandbox="allow-scripts"')
    expect(src).not.toContain("allow-same-origin")
  })

  it("derives its src from pidAppSrc + apiBase so it works over the tunnel", () => {
    expect(src).toContain("pidAppSrc(base, { projectId, appId })")
    expect(src).toContain("apiBase()")
  })

  it("exposes a per-app data-testid", () => {
    expect(src).toContain("data-testid={`pid-app-host-")
  })

  it("ships NO RPC bridge: no postMessage wiring or extension-host imports", () => {
    expect(src).not.toContain("mountRpcBridge")
    expect(src).not.toContain("ExtensionHost")
  })
})
