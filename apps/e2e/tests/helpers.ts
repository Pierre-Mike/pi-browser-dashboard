import { spawn, spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, type Locator, type Page } from "@playwright/test"

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
  const body: unknown = await res.json()
  const short =
    typeof body === "object" && body !== null && "short" in body && typeof body.short === "string"
      ? body.short
      : ""
  if (!short) throw new Error(`dispatch: missing short in ${JSON.stringify(body)}`)
  return { short }
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

// The session as the daemon knows it, narrowed to the fields the helpers read.
// Decoded rather than cast: the registry is another process's output.
export type RegisteredSession = {
  readonly worktreePath?: string | null
  readonly cwd?: string | null
}

const asRegisteredSession = (body: unknown): RegisteredSession => {
  if (typeof body !== "object" || body === null) return {}
  const o: Record<string, unknown> = { ...body }
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null)
  return { worktreePath: str(o.worktreePath), cwd: str(o.cwd) }
}

/**
 * The directory tree a session actually works in — its isolated worktree when
 * the supervisor made one, else its cwd. Read from the registry rather than
 * assumed: in stub mode a session works in the cwd it was dispatched with, in
 * real mode in a worktree, and a brainstorm board only belongs to a session if
 * the file sits inside whichever of the two it is.
 */
export const sessionRootOf = (session: RegisteredSession): string => {
  const root = session.worktreePath ?? session.cwd
  if (!root) throw new Error("sessionRootOf: session has neither worktreePath nor cwd")
  return root
}

export const waitForSessionInRegistry = async (
  short: string,
  timeoutMs = 10_000,
): Promise<RegisteredSession> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://localhost:${DAEMON_PORT}/sessions/${short}`)
      if (r.ok) return asRegisteredSession(await r.json())
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
  extLocalDir?: string
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

export const startDaemon = async (envOverride: Record<string, string> = {}): Promise<void> => {
  const m = readManifest()
  const child = spawn("bun", ["run", m.daemonMain], {
    cwd: join(m.sandbox, "workspace"),
    env: { ...process.env, ...m.daemonEnv, ...envOverride },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  })
  child.unref()
  child.stdout?.on("data", (b) => process.stderr.write(`[daemon-restart] ${b}`))
  child.stderr?.on("data", (b) => process.stderr.write(`[daemon-restart] ${b}`))
  await waitForUrl(`http://localhost:${m.daemonPort}/sessions`)
  writeManifest({ ...m, daemonPid: child.pid ?? null })
}

export const restartDaemon = async (envOverride: Record<string, string> = {}): Promise<void> => {
  await killDaemon()
  await startDaemon(envOverride)
}

export const extLocalDir = (): string => {
  const dir = process.env.PID_E2E_EXT_LOCAL_DIR ?? readManifest().extLocalDir
  if (!dir) throw new Error("PID_E2E_EXT_LOCAL_DIR not set — is globalSetup running?")
  return dir
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

// Spawn a trivial session and wait for its card to appear and settle. Returns
// the short id. Folds the goto/dispatch/wait boilerplate shared by most specs.
export const spawnSettled = async (page: Page, opts: { cwd?: string } = {}): Promise<string> => {
  const { short } = await dispatchDirect(undefined, opts)
  await waitForCard({ page, short, timeout: 20_000 })
  await waitForSettled({ page, short })
  return short
}

// Clicking a session card no longer navigates — it opens the quick-reply
// modal. Open the modal (and let the caller assert its contents).
export const openReplyModal = async (page: Page, short: string): Promise<Locator> => {
  await cardLocator(page, short).getByTestId("session-card-name").click()
  const modal = page.getByTestId("session-reply-modal")
  await expect(modal).toBeVisible({ timeout: 10_000 })
  return modal
}

// Reach the full drill-in page the way a user now does: open the reply modal,
// then follow its "Open full session" link.
export const openSessionPage = async (page: Page, short: string): Promise<void> => {
  const modal = await openReplyModal(page, short)
  await modal.getByTestId("reply-open-full").click()
  await expect(page).toHaveURL(new RegExp(`/sessions/${short}$`))
}

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

export const waitForCard = async ({
  page,
  short,
  timeout = 30_000,
}: {
  page: Page
  short: string
  timeout?: number
}): Promise<void> => {
  await ensureProjectsTab(page)
  const card = cardLocator(page, short)
  // The card is delivered by a live SSE push. If the page's event stream was
  // not yet connected when the session was dispatched, that push is missed and
  // the card never arrives on its own. Wait a bounded window for the push, then
  // reload once to force a fresh REST hydration of the registry (deterministic)
  // before spending the rest of the budget.
  try {
    await expect(card).toBeVisible({ timeout: Math.min(timeout, 8_000) })
    return
  } catch {
    await page.reload()
    await ensureProjectsTab(page)
    await expect(card).toBeVisible({ timeout })
  }
}

export const waitForCardGone = async ({
  page,
  short,
  timeout = 30_000,
}: {
  page: Page
  short: string
  timeout?: number
}): Promise<void> => {
  await ensureProjectsTab(page)
  await expect(cardLocator(page, short)).toHaveCount(0, { timeout })
}

export type CardState = "working" | "idle" | "done" | "needs_input" | "failed" | "stopped"

export const waitForState = async ({
  page,
  short,
  state,
  timeout = 60_000,
}: {
  page: Page
  short: string
  state: CardState
  timeout?: number
}): Promise<void> => {
  await expect(cardLocator(page, short)).toHaveAttribute("data-state", state, { timeout })
}

export const waitForSettled = async ({
  page,
  short,
  timeout = 90_000,
}: {
  page: Page
  short: string
  timeout?: number
}): Promise<void> => {
  await expect(cardLocator(page, short)).toHaveAttribute("data-state", /^(idle|done|failed)$/, {
    timeout,
  })
}

/**
 * Spawn a session, seed an empty JSON Canvas board in the tree it works in, and
 * land on that board in the Brainstorm section — the only surface the shared
 * canvas editor renders on. The seeded document is empty so a spec can assert on
 * a blank board; `path` names it inside the session's root.
 *
 * The board shares its row with the boards rail and the session's own terminal,
 * so at the default viewport the editor pane is only ~370px wide — narrow enough
 * that React Flow's fitView zooms a single node past the pane edges and pointer
 * geometry stops meaning anything. Widen the window and collapse the rail so a
 * drawing spec gets a pane it can aim at.
 */
export const openSeededBoard = async ({
  page,
  project,
  path = "board.canvas",
}: {
  page: Page
  project: string
  path?: string
}): Promise<string> => {
  const cwd = ensureProject(project)
  const { short } = await dispatchDirect(undefined, { cwd })
  const root = sessionRootOf(await waitForSessionInRegistry(short))
  const file = join(root, path)
  mkdirSync(join(file, ".."), { recursive: true })
  writeFileSync(file, JSON.stringify({ nodes: [], edges: [] }))

  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto(`/sessions/${short}?tab=brainstorm`)
  await expect(page.getByTestId("canvas-tab")).toBeVisible({ timeout: 15_000 })
  await page.getByTestId("brainstorm-subtabs-collapse").click()
  await expect(page.getByTestId("brainstorm-subtabs")).not.toBeAttached()
  return short
}
