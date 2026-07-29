import { describe, expect, it } from "bun:test"
import {
  buildDiscovery,
  claudeDiscoveryFlags,
  discoveryBaseUrl,
  discoveryChildEnv,
  discoverySkillUrl,
  pidShimScript,
} from "./agent-discovery.core"

const armed = buildDiscovery({
  baseUrl: "http://localhost:8787",
  apiPrefix: "",
  pidBin: "/home/me/.claude/pid-dashboard/bin/pid",
  shimDir: "/home/me/.claude/pid-dashboard/bin",
  withPointer: false,
})

describe("discoveryBaseUrl / discoverySkillUrl", () => {
  it("names the daemon by the port it actually bound, not a configured guess", () => {
    expect(discoveryBaseUrl({ port: 9123 })).toBe("http://localhost:9123")
  })

  it("serves the skill at the bare root for the dev daemon layout", () => {
    expect(discoverySkillUrl({ baseUrl: "http://localhost:8787", apiPrefix: "" })).toBe(
      "http://localhost:8787/agent-skill.md",
    )
  })

  // Under the pid-dashboard single-port layout the SPA owns "/" and 404s
  // /agent-skill.md — the document only exists behind the API prefix.
  it("moves the skill behind the api prefix for the single-port layout", () => {
    expect(discoverySkillUrl({ baseUrl: "http://localhost:8787", apiPrefix: "/__api" })).toBe(
      "http://localhost:8787/__api/agent-skill.md",
    )
  })
})

describe("buildDiscovery", () => {
  it("publishes the base url, the skill url and the pid binary as env", () => {
    expect(armed.env).toEqual({
      PID_URL: "http://localhost:8787",
      PID_SKILL_URL: "http://localhost:8787/agent-skill.md",
      PID_BIN: "/home/me/.claude/pid-dashboard/bin/pid",
    })
  })

  // A daemon that could not resolve a `pid` command still teaches the HTTP
  // surface: PID_BIN must be absent rather than a path that does not run.
  it("omits PID_BIN when no pid command could be resolved", () => {
    const noBin = buildDiscovery({
      baseUrl: "http://localhost:8787",
      apiPrefix: "",
      withPointer: false,
    })
    expect(noBin.env.PID_BIN).toBeUndefined()
    expect(noBin.shimDir).toBeUndefined()
    expect(Object.keys(noBin.env).sort()).toEqual(["PID_SKILL_URL", "PID_URL"])
  })

  it("keeps the pointer line absent unless it was explicitly asked for", () => {
    expect(armed.pointer).toBeUndefined()
  })

  it("names the skill url and the binary in the pointer line when asked for", () => {
    const withPointer = buildDiscovery({
      baseUrl: "http://localhost:8787",
      apiPrefix: "",
      pidBin: "/bin/pid",
      shimDir: "/bin",
      withPointer: true,
    })
    expect(withPointer.pointer).toContain("http://localhost:8787/agent-skill.md")
    expect(withPointer.pointer).toContain("/bin/pid")
  })
})

describe("claudeDiscoveryFlags", () => {
  // `claude --bg` hands the run to a pre-warmed spare whose environment
  // predates the dispatch, so plain child env never reaches the session —
  // settings JSON on argv is the only carrier that does.
  it("carries the env as a --settings json object", () => {
    expect(claudeDiscoveryFlags(armed)).toEqual(["--settings", JSON.stringify({ env: armed.env })])
  })

  it("adds nothing at all when the daemon never armed discovery", () => {
    expect(claudeDiscoveryFlags(undefined)).toEqual([])
  })

  // Opt-in only: the pointer rides the system prompt, never the user's own
  // intent, so an existing spawn's prompt is byte-identical either way.
  it("appends the pointer to the system prompt when one was built", () => {
    const withPointer = buildDiscovery({
      baseUrl: "http://localhost:8787",
      apiPrefix: "",
      withPointer: true,
    })
    const flags = claudeDiscoveryFlags(withPointer)
    expect(flags[2]).toBe("--append-system-prompt")
    expect(flags[3]).toBe(withPointer.pointer)
  })
})

describe("discoveryChildEnv", () => {
  it("returns the env unchanged when discovery was never armed", () => {
    expect(discoveryChildEnv({ env: { HOME: "/home/me" }, discovery: undefined })).toEqual({
      HOME: "/home/me",
    })
  })

  it("adds the discovery vars and prepends the shim dir to PATH", () => {
    const out = discoveryChildEnv({
      env: { HOME: "/home/me", PATH: "/usr/bin:/bin" },
      discovery: armed,
    })
    expect(out.HOME).toBe("/home/me")
    expect(out.PID_URL).toBe("http://localhost:8787")
    expect(out.PATH).toBe("/home/me/.claude/pid-dashboard/bin:/usr/bin:/bin")
  })

  it("does not prepend the shim dir twice", () => {
    const once = discoveryChildEnv({
      env: { PATH: "/usr/bin" },
      discovery: armed,
    })
    expect(discoveryChildEnv({ env: once, discovery: armed }).PATH).toBe(once.PATH)
  })

  it("seeds PATH with just the shim dir when the child had none", () => {
    expect(discoveryChildEnv({ env: {}, discovery: armed }).PATH).toBe(
      "/home/me/.claude/pid-dashboard/bin",
    )
  })

  it("leaves PATH alone when there is no shim to add", () => {
    const noBin = buildDiscovery({
      baseUrl: "http://localhost:8787",
      apiPrefix: "",
      withPointer: false,
    })
    expect(discoveryChildEnv({ env: { PATH: "/usr/bin" }, discovery: noBin }).PATH).toBe("/usr/bin")
  })
})

describe("pidShimScript", () => {
  it("execs the resolved command and forwards every argument", () => {
    expect(pidShimScript({ argv: ["/opt/bun", "/repo/apps/cli/src/agent/main.ts"] })).toContain(
      `exec '/opt/bun' '/repo/apps/cli/src/agent/main.ts' "$@"`,
    )
  })

  it("starts with a POSIX shebang so the file is directly executable", () => {
    expect(pidShimScript({ argv: ["/usr/local/bin/pid"] }).startsWith("#!/bin/sh\n")).toBe(true)
  })

  // A path with a quote or a space must not break out of the exec line.
  it("single-quote escapes every argument", () => {
    expect(pidShimScript({ argv: ["/opt/my bun", "/re'po/main.ts"] })).toContain(
      `exec '/opt/my bun' '/re'\\''po/main.ts' "$@"`,
    )
  })
})
