// Imperative shell for brainstorms: named canvas documents stored under
// <project>/.pid/brainstorms/. The pure naming/discovery rules live in
// brainstorms.core.ts. Mirrors pid-apps.repo.ts (Effect Layer over
// ProjectsService); live document sync is NOT here — the canvas feature's
// path-keyed rooms (getCanvasRoomAt) own watching and broadcasting.

import { mkdir, readdir, rename, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Context, Effect, Layer } from "effect"
import { emptyCanvas, serializeCanvas } from "../canvas/canvas.core"
import { ProjectsService, resolveProjectDir } from "../projects/projects.repo"
import {
  type Brainstorm,
  brainstormFileName,
  brainstormIdFromFileName,
  brainstormsDirFor,
  isCreatableBrainstormName,
} from "./brainstorms.core"

export type BrainstormError = "not_found" | "forbidden"
export type BrainstormWriteError = BrainstormError | "invalid_name" | "already_exists"

type BrainstormsServiceApi = {
  readonly list: (projectId: string) => Effect.Effect<readonly Brainstorm[], BrainstormError, never>
  readonly create: (
    projectId: string,
    name: string,
  ) => Effect.Effect<Brainstorm, BrainstormWriteError, never>
  // Absolute path of an EXISTING document — the WS/snapshot routes hang a
  // canvas room off it. Creation is explicit (POST), so a missing file is
  // not_found rather than an auto-created empty canvas.
  readonly resolveFile: (
    projectId: string,
    slug: string,
  ) => Effect.Effect<string, BrainstormError, never>
}

export class BrainstormsService extends Context.Tag("BrainstormsService")<
  BrainstormsService,
  BrainstormsServiceApi
>() {}

const statMtime = async (path: string): Promise<string | null> => {
  try {
    const s = await stat(path)
    return s.isFile() ? s.mtime.toISOString() : null
  } catch {
    return null
  }
}

// A missing .pid/brainstorms/ just means "no brainstorms yet" — same ENOENT
// tolerance as pid-apps discovery.
const listDocs = async (dir: string): Promise<readonly Brainstorm[]> => {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const metas = await Promise.all(
    names
      .map((n) => ({ id: brainstormIdFromFileName(n), file: join(dir, n) }))
      .filter((e): e is { id: string; file: string } => e.id !== null)
      .map(async (e) => {
        const updatedAt = await statMtime(e.file)
        return updatedAt === null ? null : { id: e.id, label: e.id, file: e.file, updatedAt }
      }),
  )
  return metas
    .filter((m): m is Brainstorm => m !== null)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

// tmp+rename so a concurrent reader (a canvas room priming its cache, or an
// agent's Read) never observes a half-written document.
const writeAtomic = async (path: string, body: string): Promise<void> => {
  const tmp = `${path}.${process.pid}.tmp`
  await writeFile(tmp, body, "utf8")
  await rename(tmp, path)
}

const createDoc = async (dir: string, id: string): Promise<"ok" | "already_exists"> => {
  const file = join(dir, brainstormFileName(id))
  if ((await statMtime(file)) !== null) return "already_exists"
  await mkdir(dir, { recursive: true })
  await writeAtomic(file, serializeCanvas(emptyCanvas()))
  return "ok"
}

export const BrainstormsRepoLive: Layer.Layer<BrainstormsService, never, ProjectsService> =
  Layer.effect(
    BrainstormsService,
    Effect.gen(function* () {
      const projects = yield* ProjectsService
      return {
        list: (projectId) =>
          Effect.gen(function* () {
            const projectPath = yield* resolveProjectDir(projects, projectId)
            return yield* Effect.promise(() => listDocs(brainstormsDirFor(projectPath)))
          }),

        create: (projectId, name) =>
          Effect.gen(function* () {
            if (!isCreatableBrainstormName(name)) {
              return yield* Effect.fail<BrainstormWriteError>("invalid_name")
            }
            const projectPath = yield* resolveProjectDir(projects, projectId)
            const dir = brainstormsDirFor(projectPath)
            const result = yield* Effect.promise(() => createDoc(dir, name))
            if (result === "already_exists") {
              return yield* Effect.fail<BrainstormWriteError>("already_exists")
            }
            // Route the response through the same discovery path list() uses,
            // so the create response can never drift from a later GET.
            const docs = yield* Effect.promise(() => listDocs(dir))
            const created = docs.find((d) => d.id === name)
            if (!created) return yield* Effect.fail<BrainstormWriteError>("not_found")
            return created
          }),

        resolveFile: (projectId, slug) =>
          Effect.gen(function* () {
            // NAME_RE validation doubles as the traversal guard: a slug can
            // never contain "/", "\" or "..".
            if (!isCreatableBrainstormName(slug)) {
              return yield* Effect.fail<BrainstormError>("not_found")
            }
            const projectPath = yield* resolveProjectDir(projects, projectId)
            const file = join(brainstormsDirFor(projectPath), brainstormFileName(slug))
            const mtime = yield* Effect.promise(() => statMtime(file))
            if (mtime === null) return yield* Effect.fail<BrainstormError>("not_found")
            return file
          }),
      }
    }),
  )
