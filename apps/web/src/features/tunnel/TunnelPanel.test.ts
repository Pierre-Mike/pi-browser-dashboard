import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const src = readFileSync(join(import.meta.dir, "TunnelPanel.tsx"), "utf8")

describe("TunnelPanel", () => {
  it("renders the Cloudflare URL with copy and open controls", () => {
    expect(src).toContain('data-testid="tunnel-url"')
    expect(src).toContain('data-testid="tunnel-copy"')
    expect(src).toContain('data-testid="tunnel-open"')
  })

  it("masks the URL like a password with a reveal toggle", () => {
    expect(src).toContain('data-testid="tunnel-reveal"')
    expect(src).toContain('type={revealed ? "text" : "password"}')
  })

  it("wires start/stop to the tunnel hooks", () => {
    expect(src).toContain("useStartTunnel")
    expect(src).toContain("useStopTunnel")
    expect(src).toContain("useTunnelStatus")
    expect(src).toContain('data-testid="tunnel-toggle"')
  })

  it("surfaces tunnel errors and the no-auth warning", () => {
    expect(src).toContain('data-testid="tunnel-error"')
    expect(src.toLowerCase()).toContain("no authentication")
  })
})
