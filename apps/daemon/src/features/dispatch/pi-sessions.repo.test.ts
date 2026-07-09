import { beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { encodePiSessionDir } from "./pi-sessions.core"
import { makePiSessionsApi, type PiSessionsApi } from "./pi-sessions.repo"

const ID_A = "aaaa1111-2222-3333-4444-555566667777"
const ID_B = "bbbb1111-2222-3333-4444-555566667777"

const finishedTranscript = [
  JSON.stringify({ type: "session", version: 3, cwd: "/repo" }),
  JSON.stringify({
    type: "message",
    message: { role: "user", content: [{ type: "text", text: "say pong" }] },
  }),
  JSON.stringify({
    type: "message",
    message: { role: "assistant", content: [{ type: "text", text: "pong" }], stopReason: "stop" },
  }),
].join("\n")

type Harness = {
  readonly api: PiSessionsApi
  readonly cwd: string
  readonly writeTranscript: (id: string, content: string) => void
  readonly alivePids: Set<number>
}

const buildHarness = (): Harness => {
  const scratch = mkdtempSync(join(tmpdir(), "pi-sessions-"))
  const cwd = join(scratch, "repo")
  mkdirSync(cwd)
  const sessionsRoot = join(scratch, "pi-sessions-root")
  const alivePids = new Set<number>()
  const api = makePiSessionsApi({
    spawnsFile: join(scratch, "pi-spawns.json"),
    sessionsRoot,
    isPidAlive: (pid) => alivePids.has(pid),
  })
  const writeTranscript = (id: string, content: string): void => {
    // pi encodes the resolved cwd (macOS tmpdir lives behind a /var symlink).
    const dir = join(sessionsRoot, encodePiSessionDir(realpathSync(cwd)))
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `2026-07-08T00-00-00-000Z_${id}.jsonl`), content)
  }
  return { api, cwd, writeTranscript, alivePids }
}

let h: Harness
beforeEach(() => {
  h = buildHarness()
})

const spawnA = () => ({
  id: ID_A,
  pid: 4242,
  cwd: h.cwd,
  intent: "say pong",
  spawnedAt: "2026-07-08T00:00:00.000Z",
})

describe("PiSessionsApi", () => {
  it("lists a recorded spawn as a working session while its pid is alive", () => {
    h.alivePids.add(4242)
    h.api.record(spawnA())
    const list = h.api.list()
    expect(list).toHaveLength(1)
    expect(list[0]?.short).toBe("aaaa1111")
    expect(list[0]?.state).toBe("working")
    expect(list[0]?.harness).toBe("pi")
  })

  it("flips to done with the assistant's answer once the transcript ends clean", () => {
    h.api.record(spawnA())
    h.writeTranscript(ID_A, finishedTranscript)
    const s = h.api.list()[0]
    expect(s?.state).toBe("done")
    expect(s?.result).toBe("pong")
  })

  it("marks a run failed when the pid died before the transcript finished", () => {
    h.api.record(spawnA())
    const s = h.api.list()[0]
    expect(s?.state).toBe("failed")
  })

  it("persists spawns across api instances (daemon restart)", () => {
    h.api.record(spawnA())
    h.writeTranscript(ID_A, finishedTranscript)
    const reloaded = makePiSessionsApi({
      spawnsFile: h.api.config.spawnsFile,
      sessionsRoot: h.api.config.sessionsRoot,
      isPidAlive: () => false,
    })
    expect(reloaded.list()[0]?.state).toBe("done")
  })

  it("remove drops a spawn by short id and reports whether it removed", () => {
    h.api.record(spawnA())
    h.api.record({ ...spawnA(), id: ID_B })
    expect(h.api.remove("aaaa1111")).toBe(true)
    expect(h.api.remove("aaaa1111")).toBe(false)
    expect(h.api.list().map((s) => s.short)).toEqual(["bbbb1111"])
  })

  it("returns an empty list when nothing was ever spawned", () => {
    expect(h.api.list()).toEqual([])
  })
})
