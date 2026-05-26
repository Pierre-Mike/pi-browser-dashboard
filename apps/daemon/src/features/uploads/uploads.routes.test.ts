import { describe, expect, it } from "bun:test"
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildUploadsApp } from "./uploads.routes"

const newTmpBase = (): string => mkdtempSync(join(tmpdir(), "pid-uploads-test-"))

const harness = (overrides?: {
  readonly now?: () => Date
  readonly uuid?: () => string
}) => {
  const baseDir = newTmpBase()
  let uuidCounter = 0
  const app = buildUploadsApp({
    baseDir,
    now: overrides?.now ?? (() => new Date("2026-05-26T10:11:12Z")),
    uuid: overrides?.uuid ?? (() => `uuid-${++uuidCounter}`),
  })
  return {
    app,
    baseDir,
    cleanup: () => rmSync(baseDir, { recursive: true, force: true }),
  }
}

const postFile = (
  app: ReturnType<typeof buildUploadsApp>,
  parts: ReadonlyArray<{ readonly field: string; readonly file: File }>,
) => {
  const form = new FormData()
  for (const p of parts) form.append(p.field, p.file)
  return app.request("/", { method: "POST", body: form })
}

describe("POST /uploads", () => {
  it("writes the dropped file to <baseDir>/<yyyy-mm-dd>/<uuid>-<name> and returns the absolute path", async () => {
    const { app, baseDir, cleanup } = harness()
    try {
      const file = new File(["hello drop"], "note.txt", { type: "text/plain" })
      const res = await postFile(app, [{ field: "file", file }])
      expect(res.status).toBe(200)
      const body = (await res.json()) as { readonly path?: unknown }
      expect(typeof body.path).toBe("string")
      const path = body.path as string
      const expectedDir = join(baseDir, "2026-05-26")
      expect(path).toBe(join(expectedDir, "uuid-1-note.txt"))
      expect(readFileSync(path, "utf8")).toBe("hello drop")
      expect(readdirSync(expectedDir)).toContain("uuid-1-note.txt")
    } finally {
      cleanup()
    }
  })

  it("sanitises path-traversal characters in the original filename", async () => {
    const { app, baseDir, cleanup } = harness()
    try {
      const file = new File(["x"], "../../../etc/passwd", { type: "text/plain" })
      const res = await postFile(app, [{ field: "file", file }])
      expect(res.status).toBe(200)
      const { path } = (await res.json()) as { path: string }
      expect(path.startsWith(baseDir)).toBe(true)
      expect(path).not.toContain("..")
      expect(path).toMatch(/uuid-1-.*passwd$/)
    } finally {
      cleanup()
    }
  })

  it("falls back to a uuid filename when the upload has no name", async () => {
    const { app, cleanup } = harness()
    try {
      const file = new File(["x"], "", { type: "application/octet-stream" })
      const res = await postFile(app, [{ field: "file", file }])
      expect(res.status).toBe(200)
      const { path } = (await res.json()) as { path: string }
      expect(path).toMatch(/uuid-1-upload$/)
    } finally {
      cleanup()
    }
  })

  it("rejects an empty upload with 400 empty_file", async () => {
    const { app, cleanup } = harness()
    try {
      const file = new File([], "blank.bin", { type: "application/octet-stream" })
      const res = await postFile(app, [{ field: "file", file }])
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: "empty_file" })
    } finally {
      cleanup()
    }
  })

  it("rejects a request with no file field with 400 missing_file", async () => {
    const { app, cleanup } = harness()
    try {
      const res = await app.request("/", { method: "POST", body: new FormData() })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: "missing_file" })
    } finally {
      cleanup()
    }
  })

  it("rejects a non-multipart body with 400 invalid_body", async () => {
    const { app, cleanup } = harness()
    try {
      const res = await app.request("/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ no: "file" }),
      })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: "invalid_body" })
    } finally {
      cleanup()
    }
  })
})
