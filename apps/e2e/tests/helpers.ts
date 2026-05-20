import { spawn, spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { type Locator, type Page, expect } from "@playwright/test"

const DAEMON_PORT = Number(process.env.PID_E2E_DAEMON_PORT ?? 18787)

export const TRIVIAL_INTENT = "say hello and exit"

export type SpawnResult = { short: string }

const ctx = (): { sandbox: string; workspace: string } => {
  const sandbox = process.env.PID_E2E_SANDBOX
  const workspace = process.env.PID_E2E_WORKSPACE
  if (!sandbox || !workspace) {
    throw new Error("e2e ctx missing — globalSetup did not set PID_E2E_SANDBOX/WORKSPACE")
  }
  return { sandbox, workspace }
}

export const dispatchDirect = async (
  intent = TRIVIAL_INTENT,
  opts: { cwd?: string } = {},
): Promise<SpawnResult> => {
  const { workspace } = ctx()
  const cwd = opts.cwd ?? workspace
  const res = await fetch(`http://localhost:${DAEMON_PORT}/dispatch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ intent, cwd }),
  })
  if (!res.ok) {
    throw new Error(`dispatch: HTTP ${res.status} ${await res.text()}`)
  }
  const body = (await res.json()) as { short?: string }
  if (!body.short) throw new Error(`dispatch: missing short in ${JSON.stringify(body)}`)
  return { short: body.short }
}

export const stopExternal = async (short: string): Promise<void> => {
  const { sandbox } = ctx()
  spawnSync("claude", ["stop", short], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: sandbox },
    timeout: 10_000,
  })
  // `claude stop` returns once the signal is sent; the supervisor flushes
  // state.json a bit later. For a still-running session that lands in
  // state=stopped; for an already-done session the worker is just removed
  // from roster.json (state stays at "done"). Either outcome is a real
  // delta the daemon's watcher can emit — wait for whichever fires first.
  const statePath = join(sandbox, "jobs", short, "state.json")
  const rosterPath = join(sandbox, "daemon", "roster.json")
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      const s = (JSON.parse(readFileSync(statePath, "utf8")) as { state?: string }).state
      if (s === "stopped") return
    } catch {
      // race on state.json write — retry
    }
    try {
      const roster = JSON.parse(readFileSync(rosterPath, "utf8")) as {
        workers?: Record<string, unknown>
      }
      if (!(short in (roster.workers ?? {}))) return
    } catch {
      // race on roster.json write — retry
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`stopExternal: ${short} did not reach stopped/removed`)
}

export const ensureProject = (name: string, opts: { gitInit?: boolean } = {}): string => {
  const { workspace } = ctx()
  const path = join(workspace, name)
  mkdirSync(path, { recursive: true })
  if (opts.gitInit) {
    mkdirSync(join(path, ".git"), { recursive: true })
  }
  return path
}

export const waitForSessionInRegistry = async (
  short: string,
  timeoutMs = 10_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://localhost:${DAEMON_PORT}/sessions/${short}`)
      if (r.ok) return
    } catch {
      // retry
    }
    await new Promise((res) => setTimeout(res, 100))
  }
  throw new Error(`session ${short} did not appear in daemon registry within ${timeoutMs}ms`)
}

type Manifest = {
  sandbox: string
  daemonMain: string
  daemonPort: number
  daemonEnv: Record<string, string>
  daemonPid: number | null
}

const readManifest = (): Manifest => {
  const { sandbox } = ctx()
  const raw = readFileSync(join(sandbox, ".e2e-manifest.json"), "utf8")
  return JSON.parse(raw) as Manifest
}

const writeManifest = (m: Manifest): void => {
  writeFileSync(join(m.sandbox, ".e2e-manifest.json"), JSON.stringify(m, null, 2))
}

const waitForUrl = async (url: string, timeoutMs = 15_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1_000) })
      if (r.ok || r.status === 404) return
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`daemon did not become ready at ${url}`)
}

const waitForPortFree = async (port: number, timeoutMs = 10_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(300) })
    } catch {
      return
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`port ${port} did not free`)
}

export const killDaemon = async (): Promise<void> => {
  const m = readManifest()
  if (m.daemonPid) {
    try {
      process.kill(m.daemonPid, "SIGTERM")
    } catch {
      // already gone
    }
  }
  await waitForPortFree(m.daemonPort)
}

export const startDaemon = async (): Promise<void> => {
  const m = readManifest()
  const child = spawn("bun", ["run", m.daemonMain], {
    cwd: join(m.sandbox, "workspace"),
    env: { ...process.env, ...m.daemonEnv },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  })
  child.unref()
  child.stdout?.on("data", (b) => process.stderr.write(`[daemon-restart] ${b}`))
  child.stderr?.on("data", (b) => process.stderr.write(`[daemon-restart] ${b}`))
  await waitForUrl(`http://localhost:${m.daemonPort}/sessions`)
  writeManifest({ ...m, daemonPid: child.pid ?? null })
}

export const restartDaemon = async (): Promise<void> => {
  await killDaemon()
  await startDaemon()
}

export const rmSession = (short: string): void => {
  const { sandbox } = ctx()
  spawnSync("claude", ["rm", short], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: sandbox },
    encoding: "utf8",
    timeout: 10_000,
  })
}

export const cardLocator = (page: Page, short: string): Locator =>
  page.locator(`[data-testid="session-card"][data-short="${short}"]`)

// Dashboards default to the Terminal tab; session cards live behind the
// "projects" tab (on /) or the "sessions" tab (on /projects/$slug). Click
// whichever is present so card assertions see a populated panel.
export const ensureProjectsTab = async (page: Page): Promise<void> => {
  for (const testid of ["dashboard-tab-projects", "project-tab-sessions"]) {
    const tab = page.getByTestId(testid)
    if (!(await tab.isVisible().catch(() => false))) continue
    const active = await tab.getAttribute("data-active")
    if (active !== "true") await tab.click()
  }
}

export const waitForCard = async (page: Page, short: string, timeout = 30_000): Promise<void> => {
  await ensureProjectsTab(page)
  await expect(cardLocator(page, short)).toBeVisible({ timeout })
}

export const waitForCardGone = async (
  page: Page,
  short: string,
  timeout = 30_000,
): Promise<void> => {
  await ensureProjectsTab(page)
  await expect(cardLocator(page, short)).toHaveCount(0, { timeout })
}

export type CardState = "working" | "idle" | "done" | "needs_input" | "failed" | "stopped"

export const waitForState = async (
  page: Page,
  short: string,
  state: CardState,
  timeout = 60_000,
): Promise<void> => {
  await expect(cardLocator(page, short)).toHaveAttribute("data-state", state, { timeout })
}

export const waitForSettled = async (
  page: Page,
  short: string,
  timeout = 90_000,
): Promise<void> => {
  await expect(cardLocator(page, short)).toHaveAttribute("data-state", /^(idle|done|failed)$/, {
    timeout,
  })
}
