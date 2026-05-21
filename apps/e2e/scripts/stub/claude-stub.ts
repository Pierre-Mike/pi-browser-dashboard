#!/usr/bin/env bun
// CI-only `claude` stub. Used when PID_E2E_USE_STUB=1 (auto-on in CI) so the
// e2e suite can run on a runner that has no real Claude Code CLI installed.
//
// The daemon perceives sessions entirely through two files written by the
// supervisor:
//
//   $CLAUDE_CONFIG_DIR/daemon/roster.json
//   $CLAUDE_CONFIG_DIR/jobs/<short>/state.json
//
// So a faithful stub never needs to actually run an LLM — it just maintains
// those two files in shapes that satisfy `parseRoster` / `parseState` in
// apps/daemon/src/features/sessions/sessions.core.ts.
//
// Subcommands implemented:
//   claude --bg [--agent X] [--permission-mode Y] [--session-id Z] "<intent>"
//   claude stop <short>
//   claude rm <short>
//   claude respawn <short>
//   claude peek <short>
//   claude attach <short>
//   claude tick <short>          (internal — drives state working -> done)
//
// Exit codes and stdout match what apps/daemon/src/platform/shell.repo.ts
// parses (`backgrounded · <short>` on a line by itself).

import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

// ---- paths / fs ------------------------------------------------------------

export const configDir = (): string => {
  const dir = process.env.CLAUDE_CONFIG_DIR
  if (!dir) {
    process.stderr.write("[claude-stub] CLAUDE_CONFIG_DIR not set\n")
    process.exit(2)
  }
  return dir
}

const rosterPath = (dir: string): string => join(dir, "daemon", "roster.json")
const statePath = (dir: string, short: string): string => join(dir, "jobs", short, "state.json")
const jobDir = (dir: string, short: string): string => join(dir, "jobs", short)

const readJsonOr = <T>(file: string, fallback: T): T => {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T
  } catch {
    return fallback
  }
}

// Atomic-ish write: write tmp + rename, matching the supervisor's pattern so
// the daemon's debounced JSON re-read (`readJsonWithRetry`) lands on a
// complete file.
const writeJsonAtomic = (file: string, data: unknown): void => {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`)
  // node:fs rename is sync, atomic on same fs.
  require("node:fs").renameSync(tmp, file)
}

// ---- roster / state mutators (pure-ish, exported for unit tests) -----------

export type StubWorker = {
  pid: number
  sessionId: string
  cwd: string
  startedAt: number
  attempt: number
  cliVersion: string
  dispatch: { agent?: string; seed: { intent: string } }
}

export type StubRoster = {
  proto: number
  supervisorPid: number
  updatedAt: number
  workers: Record<string, StubWorker>
}

export type StubState = {
  state: "working" | "done" | "failed" | "stopped" | "idle" | "needs_input"
  intent: string
  name?: string
  sessionId: string
  daemonShort: string
  cwd: string
  cliVersion: string
  createdAt: string
  updatedAt: string
  output?: { result?: unknown }
  detail?: string | null
  tempo?: string | null
}

export const upsertWorker = (
  roster: StubRoster,
  short: string,
  worker: StubWorker,
): StubRoster => ({
  ...roster,
  updatedAt: Date.now(),
  workers: { ...roster.workers, [short]: worker },
})

export const removeWorker = (roster: StubRoster, short: string): StubRoster => {
  const { [short]: _drop, ...rest } = roster.workers
  return { ...roster, updatedAt: Date.now(), workers: rest }
}

export const emptyRoster = (): StubRoster => ({
  proto: 1,
  supervisorPid: process.pid,
  updatedAt: Date.now(),
  workers: {},
})

const SHORT_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789"
export const randomShort = (rng: () => number = Math.random): string => {
  let out = ""
  for (let i = 0; i < 8; i++) {
    out += SHORT_ALPHABET[Math.floor(rng() * SHORT_ALPHABET.length)]
  }
  return out
}

// ---- argv parsing ----------------------------------------------------------

export type DispatchArgs = {
  agent?: string
  permissionMode?: string
  sessionId?: string
  intent: string
}

// claude --bg [--agent X] [--permission-mode Y] [--session-id Z] "<intent>"
//
// Real CLI tolerates options anywhere; the daemon emits --bg first, then
// optional flags, then a single positional intent.
export const parseDispatch = (argv: ReadonlyArray<string>): DispatchArgs => {
  let agent: string | undefined
  let permissionMode: string | undefined
  let sessionId: string | undefined
  const positional: string[] = []
  let i = 0
  while (i < argv.length) {
    const a = argv[i]
    if (a === "--bg") {
      i++
    } else if (a === "--agent" && i + 1 < argv.length) {
      agent = argv[i + 1]
      i += 2
    } else if (a === "--permission-mode" && i + 1 < argv.length) {
      permissionMode = argv[i + 1]
      i += 2
    } else if (a === "--session-id" && i + 1 < argv.length) {
      sessionId = argv[i + 1]
      i += 2
    } else if (a?.startsWith("--")) {
      // unknown flag with value
      if (i + 1 < argv.length && !argv[i + 1]?.startsWith("--")) i += 2
      else i++
    } else if (a !== undefined) {
      positional.push(a)
      i++
    } else {
      i++
    }
  }
  const intent = positional[positional.length - 1] ?? ""
  return { agent, permissionMode, sessionId, intent }
}

// ---- iso timestamp ---------------------------------------------------------

const nowIso = (): string => new Date().toISOString()

// ---- subcommands -----------------------------------------------------------

const cmdDispatch = (rest: ReadonlyArray<string>): void => {
  const dir = configDir()
  const { agent, sessionId, intent } = parseDispatch(rest)
  const short = randomShort()
  const cwd = process.cwd()
  const startedAt = Date.now()
  const sid = sessionId ?? `stub-${short}`

  // 1) roster.json — add this worker
  const rfile = rosterPath(dir)
  const cur = readJsonOr<StubRoster>(rfile, emptyRoster())
  const next = upsertWorker(cur, short, {
    pid: process.pid,
    sessionId: sid,
    cwd,
    startedAt,
    attempt: 1,
    cliVersion: "stub-0.0.0",
    dispatch: { agent, seed: { intent } },
  })
  writeJsonAtomic(rfile, next)

  // 2) state.json — initial state=working
  const sfile = statePath(dir, short)
  const stateNow = nowIso()
  const stateInitial: StubState = {
    state: "working",
    intent,
    sessionId: sid,
    daemonShort: short,
    cwd,
    cliVersion: "stub-0.0.0",
    createdAt: stateNow,
    updatedAt: stateNow,
    tempo: "working",
    detail: "stub session",
  }
  writeJsonAtomic(sfile, stateInitial)

  // 3) Fork a detached `tick` worker that flips the state to done after a
  //    short delay. Detached so the daemon's runClaude can collect stdout
  //    and resolve immediately while the simulated session "runs" in the bg.
  const selfPath = fileURLToPath(import.meta.url)
  const tickDelay = Number(process.env.PID_E2E_STUB_TICK_MS ?? 600)
  const child = spawn(process.execPath, ["run", selfPath, "tick", short, String(tickDelay)], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  })
  child.unref()

  // 4) Match real CLI: `backgrounded · <short>` on its own line.
  process.stdout.write(`backgrounded · ${short}\n`)
  process.exit(0)
}

const cmdTick = (rest: ReadonlyArray<string>): void => {
  // Internal: drive state.json from working → done after delay.
  const short = rest[0]
  const delayMs = Number(rest[1] ?? 600)
  if (!short) process.exit(2)
  setTimeout(() => {
    const dir = configDir()
    const sfile = statePath(dir, short)
    if (!existsSync(sfile)) process.exit(0) // session removed during tick
    const cur = readJsonOr<Partial<StubState>>(sfile, {} as Partial<StubState>)
    if (cur.state === "stopped" || cur.state === "done" || cur.state === "failed") {
      // already finalized by another command (stop/rm)
      process.exit(0)
    }
    // Stay at `idle` rather than `done`. waitForSettled accepts idle, and
    // drill-in / stop actions need the session to look "alive" so the Kill
    // button stays in the DOM. Real claude can take many seconds before
    // transitioning to done; idle is a faithful "running-and-waiting" state.
    const next: StubState = {
      ...(cur as StubState),
      state: "idle",
      updatedAt: nowIso(),
      tempo: "idle",
      detail: "stub idle",
      // `result` MUST be a string — the card UI calls `result.split(...)`.
      output: { result: "stub session settled" },
    }
    writeJsonAtomic(sfile, next)
    process.exit(0)
  }, delayMs)
}

const cmdStop = (rest: ReadonlyArray<string>): void => {
  const short = rest[0]
  if (!short) process.exit(2)
  const dir = configDir()
  const sfile = statePath(dir, short)
  if (existsSync(sfile)) {
    const cur = readJsonOr<Partial<StubState>>(sfile, {} as Partial<StubState>)
    const next: StubState = {
      ...(cur as StubState),
      state: "stopped",
      updatedAt: nowIso(),
      tempo: "stopped",
      detail: "stub stop",
    }
    writeJsonAtomic(sfile, next)
  }
  process.exit(0)
}

const cmdRm = (rest: ReadonlyArray<string>): void => {
  const short = rest[0]
  if (!short) process.exit(2)
  const dir = configDir()
  const rfile = rosterPath(dir)
  if (existsSync(rfile)) {
    const cur = readJsonOr<StubRoster>(rfile, emptyRoster())
    writeJsonAtomic(rfile, removeWorker(cur, short))
  }
  rmSync(jobDir(dir, short), { recursive: true, force: true })
  process.exit(0)
}

const cmdRespawn = (rest: ReadonlyArray<string>): void => {
  // Reset the session to working and tick toward done.
  const short = rest[0]
  if (!short) process.exit(2)
  const dir = configDir()
  const sfile = statePath(dir, short)
  if (existsSync(sfile)) {
    const cur = readJsonOr<Partial<StubState>>(sfile, {} as Partial<StubState>)
    const next: StubState = {
      ...(cur as StubState),
      state: "working",
      updatedAt: nowIso(),
      tempo: "working",
      detail: "stub respawn",
    }
    writeJsonAtomic(sfile, next)
    // re-tick
    const selfPath = fileURLToPath(import.meta.url)
    const child = spawn(process.execPath, ["run", selfPath, "tick", short, "600"], {
      detached: true,
      stdio: "ignore",
      env: process.env,
    })
    child.unref()
  }
  process.exit(0)
}

const cmdPeek = (rest: ReadonlyArray<string>): void => {
  const short = rest[0]
  if (!short) process.exit(2)
  process.stdout.write(`stub peek summary for ${short}: ok\n`)
  process.exit(0)
}

const cmdAttach = (rest: ReadonlyArray<string>): void => {
  // Used by the terminal/session WS handler and the SendKeys pool. We just
  // need a process that stays alive, drains stdin, writes some bytes so the
  // pty-fed terminal renders *something*, and exits on Ctrl+Z (0x1a).
  const short = rest[0] ?? "?"
  process.stdout.write(`stub attach ${short} ready\r\n`)
  process.stdin.on("data", (buf: Buffer) => {
    for (const b of buf) {
      if (b === 0x1a) process.exit(0)
    }
    // echo to mimic activity
    process.stdout.write(buf)
  })
  // Keep alive until parent closes stdin.
  process.stdin.resume()
}

const main = (): void => {
  const argv = process.argv.slice(2)
  const first = argv[0]
  // --bg may appear as the first token (dispatch mode), or stop/rm/etc.
  if (first === "--bg") {
    cmdDispatch(argv)
    return
  }
  if (first === "stop") {
    cmdStop(argv.slice(1))
    return
  }
  if (first === "rm") {
    cmdRm(argv.slice(1))
    return
  }
  if (first === "respawn") {
    cmdRespawn(argv.slice(1))
    return
  }
  if (first === "peek") {
    cmdPeek(argv.slice(1))
    return
  }
  if (first === "attach") {
    cmdAttach(argv.slice(1))
    return
  }
  if (first === "tick") {
    cmdTick(argv.slice(1))
    return
  }
  if (first === "--version") {
    process.stdout.write("claude-stub 0.0.0\n")
    process.exit(0)
  }
  process.stderr.write(`[claude-stub] unknown command: ${argv.join(" ")}\n`)
  process.exit(2)
}

// Only run main when invoked as a script (not when imported by tests).
const __filename = fileURLToPath(import.meta.url)
const isEntry =
  process.argv[1] !== undefined &&
  (process.argv[1] === __filename || process.argv[1].endsWith("/claude-stub.ts"))
if (isEntry) {
  // tmpdir reference forces the import to remain — biome no-unused-imports.
  void tmpdir
  main()
}
