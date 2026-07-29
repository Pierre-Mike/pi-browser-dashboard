import { describe, expect, it } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Exit } from "effect"
import { discoveryChildEnv } from "../../platform/agent-discovery.core"
import { createAgentDiscovery } from "../../platform/agent-discovery.io"
import { ShellError } from "../../platform/shell.io"
import { piDispatchSessionName, spawnLaunchChecked } from "./pi.io"

const scratch = mkdtempSync(join(tmpdir(), "pi-repo-test-"))
let n = 0
const stderrPath = () => join(scratch, `stderr-${++n}.log`)

const run = (cmd: readonly string[], windowMs: number) =>
  Effect.runPromiseExit(
    spawnLaunchChecked({ cmd, cwd: scratch, stderrPath: stderrPath(), windowMs }),
  )

const runWithEnv = (args: {
  cmd: readonly string[]
  windowMs: number
  env: Record<string, string>
}) => {
  const path = stderrPath()
  return {
    path,
    exit: Effect.runPromiseExit(
      spawnLaunchChecked({
        cmd: args.cmd,
        cwd: scratch,
        stderrPath: path,
        windowMs: args.windowMs,
        env: args.env,
      }),
    ),
  }
}

// The name a dispatched pi run is CREATED under has to be the name the attach
// path and the screen poller RESOLVE. It wasn't: this side minted a bare
// `pi-<short>` while both readers ran it through `prefixedZellijSession`, so on
// any daemon with PID_ZELLIJ_PREFIX set the dispatch created a session neither
// could see. Observed on a prefixed daemon before this existed: the poller had
// no terminal-state row at all (so `explain` reported `terminal: undefined`,
// removing the only independent evidence a pi session has), `DELETE /terminal/
// <short>` answered `{"ok":false}` and left the session running, and attaching
// resurrected a SECOND pi on the same session id under the prefixed name — two
// processes, one transcript.
describe("piDispatchSessionName", () => {
  it("prefixes the created name, so the readers resolve the session that exists", () => {
    expect(piDispatchSessionName({ short: "a98713f5", prefix: "polltest" })).toBe(
      "polltest-pi-a98713f5",
    )
  })

  // The default and the user's own daemon: an empty prefix must leave the name
  // byte-identical to what every already-running session was created under, so
  // this fix cannot orphan one.
  it("is a no-op for the empty prefix every default daemon runs with", () => {
    expect(piDispatchSessionName({ short: "a98713f5", prefix: "" })).toBe("pi-a98713f5")
  })

  // The stronger property — that this agrees with what the terminal slice's
  // readers actually compose, for every prefix — cannot be asserted from inside
  // this slice: it would mean importing that slice's internals. It lives in
  // scripts/mirrored-constants.test.ts, the file that exists for exactly this
  // (two boundaries that must agree, neither able to import the other).
})

describe("spawnLaunchChecked", () => {
  it("fails with the child's stderr when it dies non-zero inside the launch window", async () => {
    const exit = await run(
      ["sh", "-c", "echo 'No API key for provider: anthropic' >&2; exit 1"],
      2_000,
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
      const err = exit.cause.error
      expect(err).toBeInstanceOf(ShellError)
      expect(err.message).toBe("No API key for provider: anthropic")
      expect(err.exitCode).toBe(1)
    } else {
      throw new Error("expected a typed ShellError failure")
    }
  })

  it("falls back to the exit code when the child dies without stderr", async () => {
    const exit = await run(["sh", "-c", "exit 7"], 2_000)
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
      expect(exit.cause.error.message).toBe("pi exited with code 7 before starting")
    } else {
      throw new Error("expected a typed ShellError failure")
    }
  })

  it("succeeds with the live child's pid when it survives the launch window", async () => {
    const exit = await run(["sh", "-c", "sleep 2"], 200)
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.pid).toBeGreaterThan(0)
      await expect(exit.value.exited).resolves.toBe(0)
    }
  })

  it("succeeds when the child completes cleanly inside the window", async () => {
    const exit = await run(["sh", "-c", "exit 0"], 2_000)
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      await expect(exit.value.exited).resolves.toBe(0)
    }
  })

  it("fails with a spawn error for a nonexistent binary", async () => {
    const exit = await run(["definitely-not-a-real-binary-9f8e7d"], 2_000)
    expect(Exit.isFailure(exit)).toBe(true)
  })

  // A pi dispatch builds its child env itself, so unlike the claude path it can
  // carry discovery as ordinary env — including the shim dir on PATH, which is
  // what makes the bare name `pid` resolve inside the pane. Same call the real
  // dispatch makes (discoveryChildEnv over the cleaned zellij env), proven
  // against a real child rather than asserted about a string.
  it("carries discovery env and a PATH-resolvable pid into the child", async () => {
    const claudeConfigDir = mkdtempSync(join(tmpdir(), "pi-discovery-"))
    const discovery = createAgentDiscovery({ pidCommand: () => ["/bin/echo", "pid-shim-ran"] })
    discovery.arm({ port: 18787, apiPrefix: "", claudeConfigDir, withPointer: false })
    const { path, exit: exitP } = runWithEnv({
      cmd: ["sh", "-c", 'echo "$PID_URL $(command -v pid)" >&2; exit 3'],
      windowMs: 2_000,
      env: discoveryChildEnv({
        env: { PATH: process.env.PATH ?? "/usr/bin" },
        discovery: discovery.snapshot(),
      }),
    })
    expect(Exit.isFailure(await exitP)).toBe(true)
    const stderr = readFileSync(path, "utf8")
    expect(stderr).toContain("http://localhost:18787")
    expect(stderr).toContain(join(claudeConfigDir, "pid-dashboard", "bin", "pid"))
    rmSync(claudeConfigDir, { recursive: true, force: true })
  })

  it("passes an explicit env to the child (zellij spawn uses cleanZellijEnv)", async () => {
    // The pi dispatch spawns `zellij attach -b` with cleanZellijEnv so a daemon
    // running inside a zellij pane doesn't leak ZELLIJ_SESSION_NAME and trip
    // self-attach detection. Prove the env override actually reaches the child.
    const { path, exit: exitP } = runWithEnv({
      cmd: ["sh", "-c", 'echo "$PID_TEST_MARKER" >&2; exit 3'],
      windowMs: 2_000,
      env: { PATH: process.env.PATH ?? "/usr/bin", PID_TEST_MARKER: "from-env" },
    })
    const exit = await exitP
    expect(Exit.isFailure(exit)).toBe(true)
    expect(readFileSync(path, "utf8")).toContain("from-env")
  })
})
