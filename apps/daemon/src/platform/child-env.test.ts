import { describe, expect, it } from "bun:test"
import { cleanZellijEnv } from "./child-env"

// Moved here with the function itself, from features/terminal/terminal.core.test.ts:
// the config funnel now depends on this scrub to build the `childEnv` it hands
// out, so the scrub cannot live inside a feature slice.
describe("cleanZellijEnv", () => {
  it("drops the per-session markers that trigger self-attach detection", () => {
    const out = cleanZellijEnv({
      PATH: "/usr/bin",
      ZELLIJ: "0",
      ZELLIJ_SESSION_NAME: "pi-browser-dashboard",
      ZELLIJ_PANE_ID: "12",
    })
    expect(out.PATH).toBe("/usr/bin")
    expect(out.ZELLIJ).toBeUndefined()
    expect(out.ZELLIJ_SESSION_NAME).toBeUndefined()
    expect(out.ZELLIJ_PANE_ID).toBeUndefined()
  })

  it("KEEPS ZELLIJ_SOCKET_DIR — the child needs it to find the zellij daemon", () => {
    const out = cleanZellijEnv({ ZELLIJ_SOCKET_DIR: "/var/z", ZELLIJ_SESSION_NAME: "x" })
    expect(out.ZELLIJ_SOCKET_DIR).toBe("/var/z")
    expect(out.ZELLIJ_SESSION_NAME).toBeUndefined()
  })

  it("keeps ZELLIJ_CONFIG_DIR / ZELLIJ_CONFIG_FILE (custom config paths)", () => {
    const out = cleanZellijEnv({
      ZELLIJ_CONFIG_DIR: "/cfg",
      ZELLIJ_CONFIG_FILE: "/cfg/config.kdl",
    })
    expect(out.ZELLIJ_CONFIG_DIR).toBe("/cfg")
    expect(out.ZELLIJ_CONFIG_FILE).toBe("/cfg/config.kdl")
  })

  it("drops undefined values (Node's env-shaped Record allows them)", () => {
    const out = cleanZellijEnv({ HOME: "/h", MISSING: undefined })
    expect(out.HOME).toBe("/h")
    expect("MISSING" in out).toBe(false)
  })

  it("keeps unrelated vars untouched", () => {
    const out = cleanZellijEnv({ FOO: "bar", BAZ: "qux" })
    expect(out).toEqual({ FOO: "bar", BAZ: "qux" })
  })
})
