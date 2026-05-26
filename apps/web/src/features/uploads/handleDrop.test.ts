import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { subscribeDroppedPaths } from "./dropEvents"
import { handleDrop } from "./handleDrop"

const okUploader = (returns: ReadonlyArray<string>) => {
  let i = 0
  return async (_file: File): Promise<string> => {
    const next = returns[i++]
    if (next === undefined) throw new Error("uploader exhausted")
    return next
  }
}

const failingUploader = async (_file: File): Promise<string> => {
  throw new Error("upload_failed: synthetic")
}

const newClipboard = () => {
  const writes: string[] = []
  return { writes, writeText: async (s: string) => writes.push(s) }
}

const collectEvents = () => {
  const events: string[] = []
  const off = subscribeDroppedPaths((p) => events.push(p))
  return { events, off }
}

describe("handleDrop", () => {
  let listener: ReturnType<typeof collectEvents>

  beforeEach(() => {
    listener = collectEvents()
  })
  afterEach(() => listener.off())

  it("uploads each file, copies the joined paths to the clipboard, and emits each path", async () => {
    const clipboard = newClipboard()
    const files = [
      new File(["a"], "a.txt"),
      new File(["b"], "b.txt"),
    ] as const
    const result = await handleDrop(files, {
      upload: okUploader(["/abs/a.txt", "/abs/b.txt"]),
      clipboard,
    })
    expect(result).toEqual({
      paths: ["/abs/a.txt", "/abs/b.txt"],
      errors: [],
    })
    expect(clipboard.writes).toEqual(["/abs/a.txt /abs/b.txt"])
    expect(listener.events).toEqual(["/abs/a.txt", "/abs/b.txt"])
  })

  it("ignores empty file lists — no upload, no clipboard write, no event", async () => {
    const clipboard = newClipboard()
    const result = await handleDrop([], { upload: okUploader([]), clipboard })
    expect(result).toEqual({ paths: [], errors: [] })
    expect(clipboard.writes).toEqual([])
    expect(listener.events).toEqual([])
  })

  it("collects per-file errors and keeps successful paths", async () => {
    const clipboard = newClipboard()
    let i = 0
    const upload = async (_file: File): Promise<string> => {
      i++
      if (i === 2) throw new Error("upload_failed: empty_file")
      return `/abs/file-${i}`
    }
    const files = [
      new File(["a"], "a.txt"),
      new File([], "blank"),
      new File(["c"], "c.txt"),
    ]
    const result = await handleDrop(files, { upload, clipboard })
    expect(result.paths).toEqual(["/abs/file-1", "/abs/file-3"])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.fileName).toBe("blank")
    expect(result.errors[0]?.message).toContain("empty_file")
    expect(clipboard.writes).toEqual(["/abs/file-1 /abs/file-3"])
    expect(listener.events).toEqual(["/abs/file-1", "/abs/file-3"])
  })

  it("does not write to the clipboard when every upload fails", async () => {
    const clipboard = newClipboard()
    const result = await handleDrop([new File(["x"], "x")], {
      upload: failingUploader,
      clipboard,
    })
    expect(result.paths).toEqual([])
    expect(result.errors).toHaveLength(1)
    expect(clipboard.writes).toEqual([])
    expect(listener.events).toEqual([])
  })

  it("treats a clipboard.writeText rejection as non-fatal: paths still returned, events still emitted", async () => {
    const clipboard = {
      writeText: async (_: string) => {
        throw new DOMException("Document is not focused.", "NotAllowedError")
      },
    }
    const result = await handleDrop([new File(["a"], "a.txt")], {
      upload: okUploader(["/abs/a.txt"]),
      clipboard,
    })
    expect(result.paths).toEqual(["/abs/a.txt"])
    expect(result.errors).toEqual([])
    expect(listener.events).toEqual(["/abs/a.txt"])
  })
})
