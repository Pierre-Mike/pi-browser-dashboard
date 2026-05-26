import { access, mkdir, writeFile } from "node:fs/promises"
import { basename, extname, join } from "node:path"
import { Hono } from "hono"

type SavedFile = { readonly name: string; readonly path: string; readonly size: number }

const stripControlBytes = (s: string): string => {
  let out = ""
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) >= 0x20) out += s[i]
  }
  return out
}

const sanitizeDropName = (raw: string): string => {
  const stripped = basename(stripControlBytes(raw)).replace(/[/\\]/g, "_")
  let n = stripped
  if (!n || n === "." || n === "..") n = "unnamed"
  if (n.length > 180) {
    const ext = extname(n)
    n = n.slice(0, 180 - ext.length) + ext
  }
  return n
}

const uniqueDropPath = async (dir: string, name: string): Promise<string> => {
  const candidate = join(dir, name)
  try {
    await access(candidate)
  } catch {
    return candidate
  }
  const ext = extname(name)
  const stem = ext ? name.slice(0, -ext.length) : name
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  return join(dir, `${stem}-${stamp}${ext}`)
}

export type DropsAppOptions = {
  readonly resolveAppRoot: () => string
}

export const buildDropsApp = ({ resolveAppRoot }: DropsAppOptions) =>
  new Hono().post("/", async (c) => {
    let bodyRaw: Record<string, unknown>
    try {
      bodyRaw = (await c.req.parseBody({ all: true })) as Record<string, unknown>
    } catch {
      return c.json({ error: "bad form body" }, 400)
    }

    const activeProjectId = bodyRaw.activeProjectId
    if (typeof activeProjectId !== "string" || activeProjectId.length === 0) {
      return c.json({ error: "no active project" }, 400)
    }

    const raw = bodyRaw.files ?? []
    const files = (Array.isArray(raw) ? raw : [raw]).filter((x): x is File => x instanceof File)
    if (files.length === 0) return c.json({ error: "no files" }, 400)

    const dropsDir = join(resolveAppRoot(), "drops")
    await mkdir(dropsDir, { recursive: true })
    try {
      await access(join(dropsDir, ".gitignore"))
    } catch {
      await writeFile(join(dropsDir, ".gitignore"), "*\n!.gitignore\n")
    }

    const saved: SavedFile[] = []
    for (const f of files) {
      const safe = sanitizeDropName(f.name || "unnamed")
      const target = await uniqueDropPath(dropsDir, safe)
      await writeFile(target, Buffer.from(await f.arrayBuffer()))
      saved.push({ name: basename(target), path: target, size: f.size })
    }
    return c.json({ files: saved }, 200)
  })

const defaultResolveAppRoot = (): string => process.env.PID_APP_ROOT ?? process.cwd()

const app = buildDropsApp({ resolveAppRoot: defaultResolveAppRoot })

export { app }
