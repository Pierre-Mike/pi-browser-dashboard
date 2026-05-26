import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Hono } from "hono"
import { resolveConfigDir } from "../../platform/config-dir"

export type UploadsDeps = {
  readonly baseDir: string
  readonly now: () => Date
  readonly uuid: () => string
}

const yyyyMmDd = (d: Date): string => {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, "0")
  const day = String(d.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

// Strip directory components and any byte that could escape the basename.
// Result: a leaf filename safe to join under baseDir.
const sanitiseName = (raw: string | undefined): string => {
  const leaf = (raw ?? "").split(/[\\/]/).pop() ?? ""
  const cleaned = leaf.replace(/\.\./g, "").replace(/[^\w.\-+ ]/g, "_").trim()
  return cleaned.length > 0 ? cleaned : "upload"
}

export const buildUploadsApp = (deps: UploadsDeps) =>
  new Hono().post("/", async (c) => {
    const contentType = c.req.header("content-type") ?? ""
    if (!contentType.toLowerCase().includes("multipart/form-data")) {
      return c.json({ error: "invalid_body" }, 400)
    }
    let form: FormData
    try {
      form = await c.req.formData()
    } catch {
      return c.json({ error: "invalid_body" }, 400)
    }
    const entry = form.get("file")
    if (!(entry instanceof File)) {
      return c.json({ error: "missing_file" }, 400)
    }
    if (entry.size === 0) {
      return c.json({ error: "empty_file" }, 400)
    }
    const dir = join(deps.baseDir, yyyyMmDd(deps.now()))
    await mkdir(dir, { recursive: true })
    const safeName = sanitiseName(entry.name)
    const path = join(dir, `${deps.uuid()}-${safeName}`)
    const bytes = new Uint8Array(await entry.arrayBuffer())
    await writeFile(path, bytes)
    return c.json({ path })
  })

const defaultBaseDir = (): string => join(resolveConfigDir(), "pid-uploads")
const defaultUuid = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 10)

const app = buildUploadsApp({
  baseDir: defaultBaseDir(),
  now: () => new Date(),
  uuid: defaultUuid,
})

export const testApp = app
export { app }
