import { describe, expect, it } from "bun:test"
import { DAEMON_PORT, daemonLaunchEnv, WEBVIEW_ORIGIN, webviewUrl } from "./desktopEnv"

describe("webviewUrl", () => {
  it("points the window at the bundled SPA index", () => {
    expect(webviewUrl()).toBe("views://mainview/index.html")
  })
})

describe("daemonLaunchEnv", () => {
  it("disables the public tunnel", () => {
    expect(daemonLaunchEnv().tunnel).toBe(false)
  })

  it("binds the fixed local daemon port", () => {
    expect(daemonLaunchEnv().port).toBe(DAEMON_PORT)
    expect(DAEMON_PORT).toBe(8787)
  })

  it("opens CORS for the webview origin", () => {
    const env = daemonLaunchEnv()
    expect(env.corsOrigins).toContain(WEBVIEW_ORIGIN)
    expect(env.allowViewsOrigin).toBe(true)
  })
})
