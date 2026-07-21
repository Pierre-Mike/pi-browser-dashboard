import { describe, expect, it } from "bun:test"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Exit } from "effect"
import { ShellError } from "../../platform/shell.repo"
import { spawnLaunchChecked } from "./pi.repo"

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
