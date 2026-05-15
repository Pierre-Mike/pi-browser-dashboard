import { expect, test } from "@playwright/test"
import { dispatchDirect, rmSession } from "./helpers"

const DAEMON = `http://localhost:${process.env.PID_E2E_DAEMON_PORT ?? 18787}`

// Real transcripts require real Claude auth (the sandbox has none, so sessions
// sit in "blocked" and never write JSONL). This test asserts the route is
// mounted, accepts the request, and returns one of the documented shapes:
//   200 { messages, truncated, path }
//   404 { error: "not_found" | "no_transcript" | "transcript_read_failed" }
test("GET /sessions/:id/transcript returns a documented shape", async () => {
  const { short } = await dispatchDirect()
  try {
    // Give the supervisor a moment to register the session.
    await new Promise((r) => setTimeout(r, 1_000))

    const res = await fetch(`${DAEMON}/sessions/${short}/transcript`)
    expect([200, 404, 500]).toContain(res.status)
    const body = (await res.json()) as Record<string, unknown>

    if (res.status === 200) {
      expect(Array.isArray(body.messages)).toBe(true)
      expect(typeof body.truncated).toBe("boolean")
    } else {
      expect(typeof body.error).toBe("string")
      const validErrors = ["not_found", "no_transcript", "transcript_read_failed"]
      expect(validErrors).toContain(body.error)
    }
  } finally {
    rmSession(short)
  }
})
