// Impure side of spawn-time discovery: resolve a runnable `pid`, write the
// shim, and hold the one snapshot both dispatch paths read. See
// agent-discovery.core.ts for WHY the two paths need different carriers.
//
// Deliberately a factory + module singleton armed from the composition root
// (the same shape features/terminal/terminal-poll.io.ts uses for the screen
// poller): the base url must be the port `Bun.serve` actually bound, which
// only server.ts knows, and the two dispatch call sites are plain functions
// inside `ShellIoLive` / `PiIoLive` that must not grow a Layer dependency to
// read one string. Reads no environment — server.ts hands it the values from
// the typed config funnel.
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import {
  type AgentDiscovery,
  buildDiscovery,
  discoveryBaseUrl,
  pidShimScript,
} from "./agent-discovery.core"

// Where the shim goes: the daemon's own directory under the user's claude
// config dir, next to rules.json. Nothing outside it is ever written — a
// symlink into ~/.local/bin would be a machine-wide install the user did not
// ask for.
const SHIM_SUBDIR = ["pid-dashboard", "bin"] as const
const SHIM_NAME = "pid"
const SHIM_MODE = 0o755

/**
 * The `pid` invocation for this install shape, or `undefined` when there is
 * none to offer:
 *
 *  1. this monorepo checkout — `bun apps/cli/src/agent/main.ts` (Bun runs the
 *     TypeScript entry directly, exactly as `bun run dev:agent` does);
 *  2. the packed `pid-dashboard` bundle — `bun <dist>/agent/main.js`, the
 *     sibling `bun build` emits next to the daemon bundle for `bin.pid`;
 *  3. an already-installed `pid` on the daemon's own PATH (a global install, or
 *     `bunx pid-dashboard`, which puts the package's bins on PATH).
 *
 * `process.execPath` is this daemon's own Bun, so the shim does not depend on
 * `bun` being on the session's PATH.
 */
export const resolvePidCommand = (): readonly string[] | undefined => {
  const fromSource = join(import.meta.dir, "..", "..", "..", "cli", "src", "agent", "main.ts")
  if (existsSync(fromSource)) return [process.execPath, fromSource]
  const fromBundle = join(import.meta.dir, "agent", "main.js")
  if (existsSync(fromBundle)) return [process.execPath, fromBundle]
  const installed = Bun.which(SHIM_NAME)
  return installed === null ? undefined : [installed]
}

export type ArmInput = {
  /** The port `Bun.serve` bound — not the configured one. */
  readonly port: number
  /** `""` (dev daemon) or `"/__api"` (single-port CLI). */
  readonly apiPrefix: string
  /** `ConfigService.get().claudeConfigDir` — the shim's home. */
  readonly claudeConfigDir: string
  /** `ConfigService.get().agentPointer` — opt-in prompt pointer. */
  readonly withPointer: boolean
}

export type AgentDiscoveryApi = {
  readonly arm: (input: ArmInput) => void
  /** What the spawn paths read. `undefined` until armed. */
  readonly snapshot: () => AgentDiscovery | undefined
  /** Back to inert — for tests, and for a daemon shutting down. */
  readonly disarm: () => void
}

// Returns the shim's absolute path, or undefined if it could not be written.
// A failure here must never break a dispatch: the user asked for a session,
// not for a shim, so we log and fall back to url-only discovery.
const writeShim = ({
  claudeConfigDir,
  argv,
}: {
  readonly claudeConfigDir: string
  readonly argv: readonly string[]
}): string | undefined => {
  const shimPath = join(claudeConfigDir, ...SHIM_SUBDIR, SHIM_NAME)
  try {
    mkdirSync(dirname(shimPath), { recursive: true })
    writeFileSync(shimPath, pidShimScript({ argv }))
    chmodSync(shimPath, SHIM_MODE)
    return shimPath
  } catch (err) {
    console.error(`[agent-discovery] could not write the pid shim at ${shimPath}`, err)
    return undefined
  }
}

export const createAgentDiscovery = (deps: {
  readonly pidCommand: () => readonly string[] | undefined
}): AgentDiscoveryApi => {
  let current: AgentDiscovery | undefined
  return {
    arm: ({ port, apiPrefix, claudeConfigDir, withPointer }) => {
      const argv = deps.pidCommand()
      const shimPath = argv === undefined ? undefined : writeShim({ claudeConfigDir, argv })
      current = buildDiscovery({
        baseUrl: discoveryBaseUrl({ port }),
        apiPrefix,
        ...(shimPath === undefined ? {} : { pidBin: shimPath, shimDir: dirname(shimPath) }),
        withPointer,
      })
    },
    snapshot: () => current,
    disarm: () => {
      current = undefined
    },
  }
}

/**
 * The process-wide snapshot. Inert until `server.ts` arms it, so importing
 * this module changes nothing about how a session spawns.
 */
export const agentDiscovery: AgentDiscoveryApi = createAgentDiscovery({
  pidCommand: resolvePidCommand,
})
