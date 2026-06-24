import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Either, Layer } from "effect"
import { type Project, ProjectsRepoTest } from "../projects/projects.repo"
import { type PidAppError, PidAppsRepoLive, PidAppsService } from "./pid-apps.repo"

// A real on-disk project tree, discovered through the live repo layer backed by
// an in-memory ProjectsRepoTest fixture (so resolveProjectDir finds the path).
let root: string
let projA: Project
let projB: Project

const attempt = <A>(proj: Project, eff: Effect.Effect<A, PidAppError, PidAppsService>) =>
  Effect.runPromise(
    Effect.either(Effect.provide(eff, Layer.provide(PidAppsRepoLive, ProjectsRepoTest([proj])))),
  )

const list = (proj: Project, id: string) =>
  attempt(
    proj,
    Effect.flatMap(PidAppsService, (s) => s.listApps(id)),
  )
const asset = (proj: Project, q: { id: string; appId: string; rel: string }) =>
  attempt(
    proj,
    Effect.flatMap(PidAppsService, (s) => s.resolveAsset(q.id, { appId: q.appId, rel: q.rel })),
  )

const project = (id: string, path: string): Project => ({
  id,
  name: id,
  path,
  isGitRepo: false,
  lastModified: 0,
})

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "pidapps-"))
  const pid = join(root, "projA", ".pid")
  await mkdir(join(pid, "spec", "assets"), { recursive: true })
  await mkdir(join(pid, "extensions", "foo"), { recursive: true })
  await writeFile(join(pid, "index.html"), "<h1>default app</h1>")
  await writeFile(join(pid, "spec", "index.html"), "<h1>spec</h1>")
  await writeFile(join(pid, "spec", "main.html"), "<h1>spec main</h1>")
  await writeFile(
    join(pid, "spec", "pid-app.json"),
    JSON.stringify({ title: "My Spec", entry: "main.html" }),
  )
  await writeFile(join(pid, "spec", "assets", "app.js"), "console.log(1)")
  await writeFile(join(pid, "settings.json"), "{}")
  await writeFile(join(pid, "extensions", "foo", "manifest.json"), "{}")
  // A secret OUTSIDE .pid, and a symlink inside an app that points at it.
  await writeFile(join(root, "secret.txt"), "TOPSECRET")
  await symlink(join(root, "secret.txt"), join(pid, "spec", "escape"))
  projA = project("projA", join(root, "projA"))
  projB = project("projB", join(root, "projB")) // dir intentionally absent
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("PidAppsRepoLive.listApps", () => {
  it("discovers the bare-root default app and each subdir app, applying pid-app.json", async () => {
    const r = await list(projA, "projA")
    expect(Either.isRight(r)).toBe(true)
    if (Either.isRight(r)) {
      expect(r.right.map((a) => a.id)).toEqual(["default", "spec"])
      expect(r.right.find((a) => a.id === "spec")).toMatchObject({
        label: "My Spec",
        entry: "main.html",
        root: "spec",
      })
    }
  })

  it("returns [] for a project with no .pid directory", async () => {
    const r = await list(projB, "projB")
    expect(r).toEqual(Either.right([]))
  })

  it("fails not_found for an unknown project id", async () => {
    expect(await list(projA, "ghost")).toEqual(Either.left("not_found"))
  })

  it("fails forbidden for an unsafe project id", async () => {
    expect(await list(projA, "..")).toEqual(Either.left("forbidden"))
  })
})

describe("PidAppsRepoLive.resolveAsset", () => {
  it("serves the default app index.html with the right mime", async () => {
    const r = await asset(projA, { id: "projA", appId: "default", rel: "index.html" })
    expect(Either.isRight(r)).toBe(true)
    if (Either.isRight(r)) {
      expect(r.right.mime).toBe("text/html; charset=utf-8")
      expect(r.right.size).toBeGreaterThan(0)
      expect(r.right.absPath.endsWith(join(".pid", "index.html"))).toBe(true)
    }
  })

  it("serves the manifest entry override for the bare app path", async () => {
    const r = await asset(projA, { id: "projA", appId: "spec", rel: "" })
    expect(Either.isRight(r)).toBe(true)
    if (Either.isRight(r)) {
      expect(r.right.absPath.endsWith(join("spec", "main.html"))).toBe(true)
    }
  })

  it("serves nested sub-resources with the right mime", async () => {
    const r = await asset(projA, { id: "projA", appId: "spec", rel: "assets/app.js" })
    expect(Either.isRight(r)).toBe(true)
    if (Either.isRight(r)) {
      expect(r.right.mime).toBe("text/javascript; charset=utf-8")
    }
  })

  it("refuses string-layer traversal out of the app root", async () => {
    expect(await asset(projA, { id: "projA", appId: "spec", rel: "../../secret.txt" })).toEqual(
      Either.left("forbidden"),
    )
  })

  it("refuses a symlink that escapes the app root (realpath guard)", async () => {
    expect(await asset(projA, { id: "projA", appId: "spec", rel: "escape" })).toEqual(
      Either.left("forbidden"),
    )
  })

  it("refuses reserved pid internals served via the default app", async () => {
    expect(await asset(projA, { id: "projA", appId: "default", rel: "settings.json" })).toEqual(
      Either.left("forbidden"),
    )
    expect(
      await asset(projA, { id: "projA", appId: "default", rel: "extensions/foo/manifest.json" }),
    ).toEqual(Either.left("forbidden"))
  })

  it("refuses a reserved appId at the serve route (independent of discovery)", async () => {
    expect(await asset(projA, { id: "projA", appId: "extensions", rel: "manifest.json" })).toEqual(
      Either.left("not_found"),
    )
  })

  it("fails not_found for a valid but non-existent appId", async () => {
    expect(await asset(projA, { id: "projA", appId: "ghost", rel: "index.html" })).toEqual(
      Either.left("not_found"),
    )
  })
})
