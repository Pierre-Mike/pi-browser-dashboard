import { type ChildProcess, spawnSync } from "node:child_process"
import { readFileSync, rmSync } from "node:fs"
import { join } from "node:path"

type E2ECtx = {
  sandbox: string
  workspace: string
  daemon: ChildProcess
  web: ChildProcess
}

declare global {
  // biome-ignore lint/style/noVar: globalThis augmentation
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

export default async function globalTeardown(): Promise<void> {
  const ctx = globalThis.__PID_E2E__
  if (!ctx) {
    process.stderr.write(`[e2e] teardown: no ctx (setup may have failed)\n`)
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

  if (persistent) {
    // Keep auth artifacts (.claude.json, settings*.json, .credentials.json,
    // sessions/, plugins/) untouched. Wipe per-run state only.
    process.stderr.write(`[e2e] persistent auth dir — scrubbing ephemeral state\n`)
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
