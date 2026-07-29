import { afterEach, describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { agentDiscovery, createAgentDiscovery, resolvePidCommand } from "./agent-discovery.io"

const tmpDirs: string[] = []

const freshConfigDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "pid-discovery-"))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  agentDiscovery.disarm()
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("resolvePidCommand", () => {
  // The three install shapes: this monorepo checkout (apps/cli source), the
  // packed pid-dashboard bundle (dist/agent/main.js beside the daemon), and an
  // already-installed `pid` on PATH. Running from source, the first must win.
  it("resolves a runnable command in this checkout", () => {
    const argv = resolvePidCommand()
    expect(argv).toBeDefined()
    expect(argv?.length).toBeGreaterThan(0)
    expect(argv?.at(-1)).toContain("apps/cli/src/agent/main.ts")
  })
})

describe("agent discovery arm/snapshot", () => {
  it("is inert until armed, so an unconfigured daemon changes no spawn", () => {
    expect(agentDiscovery.snapshot()).toBeUndefined()
  })

  it("writes an executable pid shim and points PID_BIN at it", () => {
    const claudeConfigDir = freshConfigDir()
    const discovery = createAgentDiscovery({ pidCommand: () => ["/opt/bun", "/repo/main.ts"] })
    discovery.arm({ port: 9123, apiPrefix: "", claudeConfigDir, withPointer: false })
    const shim = join(claudeConfigDir, "pid-dashboard", "bin", "pid")
    expect(existsSync(shim)).toBe(true)
    // Owner-executable: a session runs this by absolute path.
    expect(statSync(shim).mode & 0o100).toBe(0o100)
    const snapshot = discovery.snapshot()
    expect(snapshot?.env.PID_BIN).toBe(shim)
    expect(snapshot?.env.PID_URL).toBe("http://localhost:9123")
    expect(snapshot?.shimDir).toBe(join(claudeConfigDir, "pid-dashboard", "bin"))
  })

  it("still publishes the urls when no pid command exists to shim", () => {
    const claudeConfigDir = freshConfigDir()
    const discovery = createAgentDiscovery({ pidCommand: () => undefined })
    discovery.arm({ port: 8787, apiPrefix: "/__api", claudeConfigDir, withPointer: false })
    const snapshot = discovery.snapshot()
    expect(snapshot?.env.PID_SKILL_URL).toBe("http://localhost:8787/__api/agent-skill.md")
    expect(snapshot?.env.PID_BIN).toBeUndefined()
    expect(existsSync(join(claudeConfigDir, "pid-dashboard", "bin", "pid"))).toBe(false)
  })

  // An unwritable config dir must degrade to url-only discovery, never break a
  // spawn: dispatch is the user's action, this is a convenience riding along.
  it("degrades to url-only discovery when the shim cannot be written", () => {
    const discovery = createAgentDiscovery({ pidCommand: () => ["/opt/bun"] })
    discovery.arm({
      port: 8787,
      apiPrefix: "",
      claudeConfigDir: "/proc/nonexistent-and-unwritable",
      withPointer: false,
    })
    const snapshot = discovery.snapshot()
    expect(snapshot?.env.PID_URL).toBe("http://localhost:8787")
    expect(snapshot?.env.PID_BIN).toBeUndefined()
    expect(snapshot?.shimDir).toBeUndefined()
  })

  it("re-arming replaces the previous snapshot rather than accumulating", () => {
    const claudeConfigDir = freshConfigDir()
    const discovery = createAgentDiscovery({ pidCommand: () => undefined })
    discovery.arm({ port: 1, apiPrefix: "", claudeConfigDir, withPointer: false })
    discovery.arm({ port: 2, apiPrefix: "", claudeConfigDir, withPointer: false })
    expect(discovery.snapshot()?.env.PID_URL).toBe("http://localhost:2")
  })
})

describe("the shim actually runs", () => {
  it("execs the real pid CLI, forwarding arguments", () => {
    const claudeConfigDir = freshConfigDir()
    const discovery = createAgentDiscovery({ pidCommand: resolvePidCommand })
    discovery.arm({ port: 8787, apiPrefix: "", claudeConfigDir, withPointer: false })
    const shim = discovery.snapshot()?.env.PID_BIN
    expect(shim).toBeDefined()
    const run = Bun.spawnSync({ cmd: [shim ?? "", "--help"] })
    expect(run.exitCode).toBe(0)
    // `pid --help` prints its usage on stderr (see apps/cli/src/agent/main.ts).
    expect(run.stderr.toString()).toContain("pid sessions")
  })
})
