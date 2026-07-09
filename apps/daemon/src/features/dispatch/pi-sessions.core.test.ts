import { describe, expect, it } from "bun:test"
import {
  derivePiState,
  encodePiSessionDir,
  isPiSessionFile,
  parsePiTranscript,
  piSpawnToSession,
} from "./pi-sessions.core"

const line = (obj: unknown): string => JSON.stringify(obj)

const userMsg = (text: string) =>
  line({ type: "message", message: { role: "user", content: [{ type: "text", text }] } })

const assistantMsg = (text: string) =>
  line({
    type: "message",
    message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" },
  })

describe("encodePiSessionDir", () => {
  it("mirrors pi's session-dir encoding: slashes to dashes, double-dash fence", () => {
    expect(encodePiSessionDir("/Users/pm/Github/pi-browser-dashboard")).toBe(
      "--Users-pm-Github-pi-browser-dashboard--",
    )
    expect(encodePiSessionDir("/private/tmp")).toBe("--private-tmp--")
  })
})

describe("isPiSessionFile", () => {
  it("matches the <timestamp>_<session-id>.jsonl naming for a given id", () => {
    const id = "044b10c3-550f-4bdb-92ab-ac75e7cb36ea"
    expect(isPiSessionFile(`2026-07-08T16-49-27-567Z_${id}.jsonl`, id)).toBe(true)
    expect(isPiSessionFile(`2026-07-08T16-49-27-567Z_${id}.jsonl.bak`, id)).toBe(false)
    expect(isPiSessionFile("2026-07-08T16-49-27-567Z_other.jsonl", id)).toBe(false)
  })
})

describe("parsePiTranscript", () => {
  it("reports a clean end and the final assistant text for a finished run", () => {
    const meta = parsePiTranscript([userMsg("say pong"), assistantMsg("pong")].join("\n"))
    expect(meta.endedClean).toBe(true)
    expect(meta.lastAssistantText).toBe("pong")
  })

  it("reports an unfinished run when the tail is still a user message", () => {
    const meta = parsePiTranscript([userMsg("say pong")].join("\n"))
    expect(meta.endedClean).toBe(false)
    expect(meta.lastAssistantText).toBeUndefined()
  })

  it("tolerates non-message entries and malformed lines", () => {
    const meta = parsePiTranscript(
      [
        line({ type: "session", version: 3, cwd: "/tmp" }),
        line({ type: "model_change", provider: "zai" }),
        "{not json",
        userMsg("go"),
        assistantMsg("done!"),
      ].join("\n"),
    )
    expect(meta.endedClean).toBe(true)
    expect(meta.lastAssistantText).toBe("done!")
  })
})

describe("derivePiState", () => {
  it("a cleanly-ended transcript is done, even if the pid lingers", () => {
    expect(derivePiState({ endedClean: true, pidAlive: true })).toBe("done")
    expect(derivePiState({ endedClean: true, pidAlive: false })).toBe("done")
  })

  it("an unfinished transcript with a live pid is working", () => {
    expect(derivePiState({ endedClean: false, pidAlive: true })).toBe("working")
  })

  it("an unfinished transcript with a dead pid is failed", () => {
    expect(derivePiState({ endedClean: false, pidAlive: false })).toBe("failed")
  })
})

describe("piSpawnToSession", () => {
  const spawn = {
    id: "044b10c3-550f-4bdb-92ab-ac75e7cb36ea",
    pid: 4242,
    cwd: "/repo",
    intent: "say pong",
    spawnedAt: "2026-07-08T16:49:27.000Z",
  }

  it("shapes a spawn into a session card payload tagged with the pi harness", () => {
    const s = piSpawnToSession({
      spawn,
      state: "done",
      lastAssistantText: "pong",
      updatedAt: "2026-07-08T16:49:55.000Z",
    })
    expect(s.harness).toBe("pi")
    expect(s.short).toBe("044b10c3")
    expect(s.sessionId).toBe(spawn.id)
    expect(s.state).toBe("done")
    expect(s.intent).toBe("say pong")
    expect(s.detail).toBe("say pong")
    expect(s.cwd).toBe("/repo")
    expect(s.createdAt).toBe("2026-07-08T16:49:27.000Z")
    expect(s.updatedAt).toBe("2026-07-08T16:49:55.000Z")
    expect(s.result).toBe("pong")
    expect(s.name).toBe("pi · 044b10c3")
  })
})
