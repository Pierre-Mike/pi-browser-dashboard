// Imperative shell for brainstorms: named drawing documents stored under
// <project>/.pid/brainstorms/ in two kinds — React-Flow canvas documents
// (<id>.canvas.json) and native Excalidraw boards (<id>.excalidraw). The pure
// naming/discovery rules live in brainstorms.core.ts. Mirrors pid-apps.repo.ts
// (Effect Layer over ProjectsService); live document sync is NOT here — the
// canvas feature's path-keyed rooms (getCanvasRoomAt / getExcalidrawRoomAt)
// own watching and broadcasting.

import { mkdir, readdir, rename, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Context, Effect, Layer } from "effect"
import { emptyCanvas, serializeCanvas } from "../canvas/canvas.core"
import { emptyExcalidrawDoc, serializeExcalidrawDoc } from "../canvas/excalidraw.core"
import { ProjectsService, resolveProjectDir } from "../projects/projects.repo"
import {
  type Brainstorm,
  type BrainstormKind,
  brainstormFileNameFor,
  brainstormsDirFor,
  discoverBrainstormDocs,
  isCreatableBrainstormName,
} from "./brainstorms.core"

export type BrainstormError = "not_found" | "forbidden"
export type BrainstormWriteError = BrainstormError | "invalid_name" | "already_exists"

type BrainstormsServiceApi = {
  readonly list: (projectId: string) => Effect.Effect<readonly Brainstorm[], BrainstormError, never>
  readonly create: (input: {
    readonly projectId: string
    readonly name: string
    readonly kind: BrainstormKind
  }) => Effect.Effect<Brainstorm, BrainstormWriteError, never>
  // Absolute path of an EXISTING document of the given kind — the WS/snapshot
  // routes hang a document room off it. Creation is explicit (POST), so a
  // missing file is not_found rather than an auto-created empty document.
  readonly resolveFile: (input: {
    readonly projectId: string
    readonly slug: string
    readonly kind: BrainstormKind
  }) => Effect.Effect<string, BrainstormError, never>
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
    discoverBrainstormDocs(names).map(async (doc) => {
      const file = join(dir, brainstormFileNameFor(doc.id, doc.kind))
      const updatedAt = await statMtime(file)
      return updatedAt === null
        ? null
        : { id: doc.id, label: doc.id, kind: doc.kind, file, updatedAt }
    }),
  )
  return metas.filter((m): m is Brainstorm => m !== null)
}

// tmp+rename so a concurrent reader (a document room priming its cache, or an
// agent's Read) never observes a half-written document.
const writeAtomic = async (path: string, body: string): Promise<void> => {
  const tmp = `${path}.${process.pid}.tmp`
  await writeFile(tmp, body, "utf8")
  await rename(tmp, path)
}

const emptyDocBody = (kind: BrainstormKind): string =>
  kind === "canvas" ? serializeCanvas(emptyCanvas()) : serializeExcalidrawDoc(emptyExcalidrawDoc())

const createDoc = async (input: {
  readonly dir: string
  readonly id: string
  readonly kind: BrainstormKind
}): Promise<"ok" | "already_exists"> => {
  // Ids are one namespace across kinds (they double as tab keys), so a name
  // taken by either document kind is taken.
  for (const kind of ["canvas", "excalidraw"] as const) {
    const taken = await statMtime(join(input.dir, brainstormFileNameFor(input.id, kind)))
    if (taken !== null) return "already_exists"
  }
  await mkdir(input.dir, { recursive: true })
  const file = join(input.dir, brainstormFileNameFor(input.id, input.kind))
  await writeAtomic(file, emptyDocBody(input.kind))
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

        create: ({ projectId, name, kind }) =>
          Effect.gen(function* () {
            if (!isCreatableBrainstormName(name)) {
              return yield* Effect.fail<BrainstormWriteError>("invalid_name")
            }
            const projectPath = yield* resolveProjectDir(projects, projectId)
            const dir = brainstormsDirFor(projectPath)
            const result = yield* Effect.promise(() => createDoc({ dir, id: name, kind }))
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

        resolveFile: ({ projectId, slug, kind }) =>
          Effect.gen(function* () {
            // NAME_RE validation doubles as the traversal guard: a slug can
            // never contain "/", "\" or "..".
            if (!isCreatableBrainstormName(slug)) {
              return yield* Effect.fail<BrainstormError>("not_found")
            }
            const projectPath = yield* resolveProjectDir(projects, projectId)
            const file = join(brainstormsDirFor(projectPath), brainstormFileNameFor(slug, kind))
            const mtime = yield* Effect.promise(() => statMtime(file))
            if (mtime === null) return yield* Effect.fail<BrainstormError>("not_found")
            return file
          }),
      }
    }),
  )
