import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// Regression guard for the broken terminal / tunnel WebSockets.
//
// The dev server proxies all daemon traffic — REST, SSE, and the terminal
// WebSocket — through the same-origin `/__api` prefix (see vite.config.ts and
// apiBase.ts). Vite implements that WS proxy with its bundled `http-proxy`,
// which relays the upstream `101 Switching Protocols` via the Node
// `httpServer.on("upgrade")` event.
//
// Bun's `node:http` compatibility layer does NOT drive that upgrade path the
// way http-proxy needs: running Vite under the Bun runtime (`bun --bun x vite`)
// makes every `/__api` WebSocket upgrade hang with no 101 — REST still works,
// so the breakage is silent. The terminal shows "connecting" forever and the
// Cloudflare tunnel's terminal is dead too. Running Vite under Node (vite's
// own `#!/usr/bin/env node` shebang, i.e. `bunx vite` WITHOUT `--bun`) relays
// the upgrade correctly.
//
// e2e never catches this because it sets VITE_API_URL straight at the daemon
// and bypasses the proxy entirely — so this static guard is the only thing
// standing between us and a re-regression. Keep the serving scripts off the
// Bun runtime.
const pkg = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf8")) as {
  scripts: Record<string, string>
}

describe("web serving scripts must run Vite under Node, not Bun", () => {
  // `dev` and `preview` both stand up an HTTP server that proxies the daemon
  // WebSocket. `build` does not serve anything, so its runtime is irrelevant.
  for (const script of ["dev", "preview"] as const) {
    it(`\`${script}\` does not force the Bun runtime (no --bun)`, () => {
      const cmd = pkg.scripts[script]
      expect(cmd).toBeDefined()
      // `bun --bun x vite` forces the Bun runtime and breaks WS proxying.
      expect(cmd).not.toContain("--bun")
      // Still actually launches vite.
      expect(cmd).toContain("vite")
    })
  }
})
