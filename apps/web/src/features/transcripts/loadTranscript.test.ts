import { describe, expect, it } from "bun:test"
import type { TranscriptMessage } from "../../lib/types"
import { parseTranscriptResponse } from "./loadTranscript"

const ok = (body: unknown) => ({
  ok: true,
  status: 200,
  json: () => Promise.resolve(body),
})

describe("parseTranscriptResponse", () => {
  it("returns the messages array from a wrapped body", async () => {
    const messages: TranscriptMessage[] = [{ type: "user", text: "hi" }]
    expect(await parseTranscriptResponse(ok({ messages }))).toEqual(messages)
  })

  it("accepts a bare array body", async () => {
    const messages: TranscriptMessage[] = [{ type: "assistant", text: "hello" }]
    expect(await parseTranscriptResponse(ok(messages))).toEqual(messages)
  })

  // Both fixtures above used to be rows with no `type` at all, cast through with
  // `as unknown as TranscriptMessage[]` — the old blind cast waved them past the
  // boundary and the renderer had to survive them. The reader now checks the one
  // field the UI branches on, so an unrecognizable row is dropped here instead.
  it("drops rows whose type is missing or unrecognized", async () => {
    expect(await parseTranscriptResponse(ok([{ role: "user" }]))).toEqual([])
    expect(await parseTranscriptResponse(ok([{ type: "telemetry" }]))).toEqual([])
    expect(await parseTranscriptResponse(ok([null, 7, "x"]))).toEqual([])
  })

  it("keeps the recognizable rows in a mixed list", async () => {
    const body = [{ type: "system", text: "boot" }, { role: "user" }]
    expect(await parseTranscriptResponse(ok(body))).toEqual([{ type: "system", text: "boot" }])
  })

  it("ignores a messages field that is not an array", async () => {
    expect(await parseTranscriptResponse(ok({ messages: "nope" }))).toEqual([])
  })

  it("defaults to empty when a wrapped body has no messages", async () => {
    expect(await parseTranscriptResponse(ok({}))).toEqual([])
  })

  // A freshly spawned session has no transcript JSONL yet — the daemon answers
  // 404 (no_transcript / ENOENT) until the link is written. That's a benign
  // "not ready" state, so it must read as an empty transcript, NOT a thrown
  // error that paints "Failed to load transcript: HTTP 404" on the chat.
  it("treats 404 as an empty, not-yet-ready transcript", async () => {
    const res = {
      ok: false,
      status: 404,
      json: () => Promise.reject(new Error("should not be read on 404")),
    }
    expect(await parseTranscriptResponse(res)).toEqual([])
  })

  it("throws on a real server error so the query surfaces it", async () => {
    const res = { ok: false, status: 500, json: () => Promise.resolve({}) }
    await expect(parseTranscriptResponse(res)).rejects.toThrow("transcript: HTTP 500")
  })
})
