import { describe, expect, it } from "bun:test"
import { resolveDaemonConfig } from "./server"

describe("resolveDaemonConfig", () => {
  it("defaults to env (dev path): port 8787, poll 120s, tunnel on", () => {
    expect(resolveDaemonConfig({}, {})).toEqual({ port: 8787, issuePollMs: 120_000, tunnel: true })
  })

  it("reads PORT / PID_ISSUE_POLL_MS / PID_TUNNEL_AUTOSTART from env", () => {
    expect(
      resolveDaemonConfig({}, { PORT: "9000", PID_ISSUE_POLL_MS: "0", PID_TUNNEL_AUTOSTART: "0" }),
    ).toEqual({ port: 9000, issuePollMs: 0, tunnel: false })
  })

  it("explicit options win over env (pid-dashboard CLI path)", () => {
    expect(
      resolveDaemonConfig({ port: 8787, tunnel: false, issuePollMs: 0 }, { PORT: "1234" }),
    ).toEqual({ port: 8787, issuePollMs: 0, tunnel: false })
  })
})
