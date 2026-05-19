import { type ChildProcess, spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, "../..")
const DAEMON_MAIN = join(REPO_ROOT, "apps/daemon/src/main.ts")
const WEB_DIR = join(REPO_ROOT, "apps/web")

const DAEMON_PORT = Number(process.env.PID_E2E_DAEMON_PORT ?? 18787)
const WEB_PORT = Number(process.env.PID_E2E_WEB_PORT ?? 15173)
const READY_TIMEOUT_MS = 30_000

const assertPortFree = async (port: number, label: string): Promise<void> => {
  try {
    const res = await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(500) })
    throw new Error(
      `${label} port ${port} already in use (got HTTP ${res.status}). ` +
        `Stop the other process or set PID_E2E_${label.toUpperCase()}_PORT.`,
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed") || msg.includes("timed out")) {
      return
    }
    throw err
  }
}

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

const waitForUrl = async (url: string, label: string): Promise<void> => {
  const deadline = Date.now() + READY_TIMEOUT_MS
  let lastErr: unknown = null
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) })
      if (res.ok || res.status === 404) return
      lastErr = new Error(`HTTP ${res.status}`)
    } catch (err) {
      lastErr = err
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr)
  throw new Error(`${label} not ready at ${url}: ${msg}`)
}

// Per-run state to scrub from a persistent auth dir between runs. Auth
// artifacts (.claude.json, settings*.json, .credentials.json, sessions/,
// plugins/) are deliberately not in this list.
const EPHEMERAL_PATHS = [
  "jobs",
  "daemon",
  "projects",
  "cache",
  "backups",
  "history.jsonl",
  "daemon.log",
  "daemon.lock",
  "daemon.status.json",
  "daemon-auth-status.json",
  "daemon-auth-cooldown",
  ".e2e-manifest.json",
] as const

const scrubEphemeral = (dir: string): void => {
  for (const name of EPHEMERAL_PATHS) {
    rmSync(join(dir, name), { recursive: true, force: true })
  }
}

export default async function globalSetup(): Promise<void> {
  await assertPortFree(DAEMON_PORT, "daemon")
  await assertPortFree(WEB_PORT, "web")

  // Persistent auth mode (default): use the persistent auth dir if it
  // exists. Override via `PID_E2E_AUTH_DIR=<path>` to point elsewhere, or
  // `PID_E2E_AUTH_DIR=` (explicit empty) to force ephemeral tmpdir.
  // macOS `/tmp` is a symlink to `/private/tmp`. Resolve so session.cwd and
  // project.path match in ProjectGrid grouping.
  const explicitAuthDir = process.env.PID_E2E_AUTH_DIR
  const defaultAuthDir = join(process.env.HOME ?? "", ".claude-e2e")
  const authDir =
    explicitAuthDir === undefined
      ? existsSync(defaultAuthDir)
        ? defaultAuthDir
        : undefined
      : explicitAuthDir.length > 0 && existsSync(explicitAuthDir)
        ? explicitAuthDir
        : undefined
  const persistent = Boolean(authDir)
  const sandbox = authDir
    ? realpathSync(authDir)
    : realpathSync(mkdtempSync(join(tmpdir(), "pid-e2e-")))
  if (persistent) scrubEphemeral(sandbox)
  const workspace = join(sandbox, "workspace")
  mkdirSync(workspace, { recursive: true })

  const daemonEnv = {
    ...process.env,
    CLAUDE_CONFIG_DIR: sandbox,
    PORT: String(DAEMON_PORT),
    PID_CORS_ORIGINS: `http://localhost:${WEB_PORT}`,
    PID_PROJECTS_ROOT: workspace,
  }

  process.stderr.write(
    `[e2e] sandbox=${sandbox} ${persistent ? "(persistent auth)" : "(ephemeral)"}\n`,
  )
  process.stderr.write(`[e2e] starting daemon on :${DAEMON_PORT}\n`)

  const daemon = spawn("bun", ["run", DAEMON_MAIN], {
    cwd: workspace,
    env: daemonEnv,
    stdio: ["ignore", "pipe", "pipe"],
  })
  daemon.stdout?.on("data", (b) => process.stderr.write(`[daemon] ${b}`))
  daemon.stderr?.on("data", (b) => process.stderr.write(`[daemon] ${b}`))
  daemon.on("exit", (code, sig) => {
    process.stderr.write(`[daemon] exited code=${code} signal=${sig}\n`)
  })

  process.stderr.write(`[e2e] starting vite on :${WEB_PORT}\n`)
  const web = spawn("bun", ["run", "dev"], {
    cwd: WEB_DIR,
    env: {
      ...process.env,
      PID_WEB_PORT: String(WEB_PORT),
      PID_DAEMON_URL: `http://localhost:${DAEMON_PORT}`,
      VITE_API_URL: `http://localhost:${DAEMON_PORT}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  web.stdout?.on("data", (b) => process.stderr.write(`[web] ${b}`))
  web.stderr?.on("data", (b) => process.stderr.write(`[web] ${b}`))
  web.on("exit", (code, sig) => {
    process.stderr.write(`[web] exited code=${code} signal=${sig}\n`)
  })

  await Promise.all([
    waitForUrl(`http://localhost:${DAEMON_PORT}/sessions`, "daemon"),
    waitForUrl(`http://localhost:${WEB_PORT}/`, "web"),
  ])

  globalThis.__PID_E2E__ = { sandbox, workspace, daemon, web }
  process.env.PID_E2E_SANDBOX = sandbox
  process.env.PID_E2E_WORKSPACE = workspace

  const manifest = {
    sandbox,
    workspace,
    persistent,
    daemonMain: DAEMON_MAIN,
    daemonPort: DAEMON_PORT,
    webPort: WEB_PORT,
    daemonEnv: {
      CLAUDE_CONFIG_DIR: sandbox,
      PORT: String(DAEMON_PORT),
      PID_CORS_ORIGINS: `http://localhost:${WEB_PORT}`,
      PID_PROJECTS_ROOT: workspace,
    },
    daemonPid: daemon.pid ?? null,
  }
  writeFileSync(join(sandbox, ".e2e-manifest.json"), JSON.stringify(manifest, null, 2))
  process.stderr.write(`[e2e] ready (daemon pid=${daemon.pid})\n`)
}
