import { type ChildProcess, spawnSync } from "node:child_process"
import { readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { E2E_ZELLIJ_PREFIX } from "./e2e-env"

type E2ECtx = {
  sandbox: string
  workspace: string
  daemon: ChildProcess
  web: ChildProcess
}

declare global {
  var __PID_E2E__: E2ECtx | undefined
}

const killProc = async (proc: ChildProcess, label: string): Promise<void> => {
  if (proc.exitCode !== null || proc.signalCode) return
  proc.kill("SIGTERM")
  const exited = await new Promise<boolean>((resolve) => {
    const t = setTimeout(() => resolve(false), 5_000)
    proc.once("exit", () => {
      clearTimeout(t)
      resolve(true)
    })
  })
  if (!exited) {
    process.stderr.write(`[e2e] ${label} did not exit, SIGKILL\n`)
    proc.kill("SIGKILL")
  }
}

// Terminal specs open real zellij sessions, which outlive the daemon that
// created them. Reap them — but ONLY the ones this run's PID_ZELLIJ_PREFIX
// namespaced. An empty prefix means the names are the user's own real sessions
// (`default`, `Orchestrator`, `<repo>`), and killing those is precisely the
// damage the prefix exists to prevent, so bail rather than guess.
const killPrefixedZellijSessions = async (): Promise<void> => {
  const prefix = E2E_ZELLIJ_PREFIX
  if (prefix.length === 0) return
  // node:child_process, not Bun.spawnSync — Playwright runs global teardown
  // under node, where the `Bun` global does not exist.
  const listed = spawnSync("zellij", ["list-sessions", "-s"], { encoding: "utf8" })
  if (listed.status !== 0 || typeof listed.stdout !== "string") return
  const names = listed.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith(`${prefix}-`))
  for (const name of names) {
    // A still-running session survives `delete-session --force` on zellij
    // 0.43, so kill first (no-op if already exited), then delete the entry.
    spawnSync("zellij", ["kill-session", name], { timeout: 10_000 })
    spawnSync("zellij", ["delete-session", "--force", name], { timeout: 10_000 })
  }
  if (names.length > 0) {
    process.stderr.write(`[e2e] reaped ${names.length} '${prefix}-' zellij session(s)\n`)
  }
}

export default async function globalTeardown(): Promise<void> {
  const ctx = globalThis.__PID_E2E__
  if (!ctx) {
    process.stderr.write("[e2e] teardown: no ctx (setup may have failed)\n")
    return
  }
  const { sandbox, daemon, web } = ctx

  const sandboxEnv = { ...process.env, CLAUDE_CONFIG_DIR: sandbox }
  let shortIds: string[] = []
  try {
    const roster = JSON.parse(readFileSync(join(sandbox, "daemon/roster.json"), "utf8")) as {
      workers?: Record<string, unknown>
    }
    shortIds = Object.keys(roster.workers ?? {})
  } catch {
    // No roster — nothing to clean.
  }
  if (shortIds.length > 0) {
    process.stderr.write(`[e2e] cleanup: stop+rm ${shortIds.length} sandbox session(s)\n`)
    for (const id of shortIds) {
      spawnSync("claude", ["stop", id], { env: sandboxEnv, timeout: 10_000 })
      spawnSync("claude", ["rm", id], { env: sandboxEnv, timeout: 10_000 })
    }
  }

  // The daemon may have been restarted mid-test; the manifest holds the
  // currently-live PID. Kill that first, then fall back to the original child.
  let persistent = false
  try {
    const manifest = JSON.parse(readFileSync(join(sandbox, ".e2e-manifest.json"), "utf8")) as {
      daemonPid?: number | null
      persistent?: boolean
    }
    persistent = Boolean(manifest.persistent)
    const livePid = manifest.daemonPid
    if (livePid && livePid !== daemon.pid) {
      try {
        process.kill(livePid, "SIGTERM")
      } catch {
        // already dead
      }
    }
  } catch {
    // no manifest
  }

  await Promise.all([killProc(daemon, "daemon"), killProc(web, "web")])

  await killPrefixedZellijSessions()

  if (persistent) {
    // Keep auth artifacts (.claude.json, settings*.json, .credentials.json,
    // sessions/, plugins/) untouched. Wipe per-run state only.
    process.stderr.write("[e2e] persistent auth dir — scrubbing ephemeral state\n")
    for (const name of [
      "jobs",
      "daemon",
      "projects",
      "workspace",
      "cache",
      "backups",
      "history.jsonl",
      "daemon.log",
      "daemon.lock",
      "daemon.status.json",
      "daemon-auth-status.json",
      "daemon-auth-cooldown",
      ".e2e-manifest.json",
    ]) {
      rmSync(join(sandbox, name), { recursive: true, force: true })
    }
  } else {
    process.stderr.write(`[e2e] rm -rf ${sandbox}\n`)
    rmSync(sandbox, { recursive: true, force: true })
  }
  globalThis.__PID_E2E__ = undefined
}
