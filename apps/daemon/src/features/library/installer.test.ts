import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import {
  copyDir,
  GitClient,
  GitError,
  makeGitClientRecorder,
  makeTempDir,
  removeDir,
} from "./installer"

describe("copyDir", () => {
  let workspace: string

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), "pid-installer-cp-"))
  })

  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it("copies a directory tree recursively", async () => {
    const src = join(workspace, "src1")
    const dst = join(workspace, "dst1")
    await mkdir(join(src, "nested"), { recursive: true })
    await writeFile(join(src, "SKILL.md"), "hi")
    await writeFile(join(src, "nested", "a.txt"), "a")
    await copyDir(src, dst)
    expect(await readFile(join(dst, "SKILL.md"), "utf8")).toBe("hi")
    expect(await readFile(join(dst, "nested", "a.txt"), "utf8")).toBe("a")
  })

  it("removes stale files at the destination before copying", async () => {
    const src = join(workspace, "src2")
    const dst = join(workspace, "dst2")
    await mkdir(src, { recursive: true })
    await writeFile(join(src, "SKILL.md"), "v2")
    // Pre-existing file in dst that no longer exists in src.
    await mkdir(dst, { recursive: true })
    await writeFile(join(dst, "stale.md"), "old")
    await copyDir(src, dst)
    expect(await readFile(join(dst, "SKILL.md"), "utf8")).toBe("v2")
    // The stale file should be gone.
    await expect(readFile(join(dst, "stale.md"), "utf8")).rejects.toThrow()
  })

  it("creates the parent directory when missing", async () => {
    const src = join(workspace, "src3")
    const dst = join(workspace, "deep", "nested", "dst3")
    await mkdir(src, { recursive: true })
    await writeFile(join(src, "f"), "ok")
    await copyDir(src, dst)
    expect(await readFile(join(dst, "f"), "utf8")).toBe("ok")
  })
})

describe("removeDir / makeTempDir", () => {
  it("removeDir is a no-op on missing paths", async () => {
    await removeDir(join(tmpdir(), "definitely-not-there-pid-installer"))
  })

  it("makeTempDir returns a unique writable directory", async () => {
    const a = await makeTempDir("pid-installer-mk")
    const b = await makeTempDir("pid-installer-mk")
    expect(a).not.toBe(b)
    await writeFile(join(a, "x"), "1")
    await removeDir(a)
    await removeDir(b)
  })
})

describe("GitClient recorder", () => {
  it("records clone calls and creates the destination", async () => {
    const rec = makeGitClientRecorder({
      cloneContents: async (dst) => {
        await writeFile(join(dst, "marker"), "cloned")
      },
    })
    const dst = await makeTempDir("pid-git-rec")
    await Effect.runPromise(
      rec.client.clone({ url: "https://example.com/r.git", dst, opts: { depth: 1 } }),
    )
    expect(rec.calls[0]?.method).toBe("clone")
    expect(await readFile(join(dst, "marker"), "utf8")).toBe("cloned")
    await removeDir(dst)
  })

  it("records pullFastForward and commitAndPush calls", async () => {
    const rec = makeGitClientRecorder()
    await Effect.runPromise(rec.client.pullFastForward("/tmp/foo"))
    const sha = await Effect.runPromise(
      rec.client.commitAndPush({ dir: "/tmp/foo", files: ["a"], message: "test" }),
    )
    expect(sha).toBe("stub-sha")
    expect(rec.calls.map((c) => c.method)).toEqual(["pullFastForward", "commitAndPush"])
  })

  it("propagates GitError from a failing clone", async () => {
    const rec = makeGitClientRecorder({ failClone: true })
    const ex = await Effect.runPromise(
      rec.client.clone({ url: "u", dst: "/tmp/x", opts: {} }).pipe(Effect.either),
    )
    expect(ex._tag).toBe("Left")
    if (ex._tag === "Left") expect(ex.left).toBeInstanceOf(GitError)
  })

  it("propagates GitError from a failing push", async () => {
    const rec = makeGitClientRecorder({ failPush: true })
    const ex = await Effect.runPromise(
      rec.client.commitAndPush({ dir: "/tmp/x", files: ["a"], message: "m" }).pipe(Effect.either),
    )
    expect(ex._tag).toBe("Left")
  })
})

describe("GitClient context tag", () => {
  it("exposes the expected method surface", () => {
    // Sanity check that the Tag exists and has identity.
    expect(GitClient).toBeDefined()
  })
})
