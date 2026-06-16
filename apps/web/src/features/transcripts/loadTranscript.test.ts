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
    const messages = [{ role: "user" }] as unknown as TranscriptMessage[]
    expect(await parseTranscriptResponse(ok({ messages }))).toEqual(messages)
  })

  it("accepts a bare array body", async () => {
    const messages = [{ role: "assistant" }] as unknown as TranscriptMessage[]
    expect(await parseTranscriptResponse(ok(messages))).toEqual(messages)
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
