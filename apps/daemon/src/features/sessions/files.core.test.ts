import { describe, expect, test } from "bun:test"
import {
  type FileChange,
  MAX_DIFF_BYTES,
  mergeChanges,
  parseNameStatus,
  parseUntracked,
  truncateDiff,
} from "./files.core"

describe("parseNameStatus", () => {
  test("returns empty for empty input", () => {
    expect(parseNameStatus("")).toEqual([])
  })

  test("parses a single modification", () => {
    expect(parseNameStatus("M\0src/foo.ts\0")).toEqual([{ path: "src/foo.ts", status: "modified" }])
  })

  test("parses adds, deletes, and type changes", () => {
    const raw = "A\0a.ts\0D\0b.ts\0T\0c.ts\0"
    expect(parseNameStatus(raw)).toEqual([
      { path: "a.ts", status: "added" },
      { path: "b.ts", status: "deleted" },
      { path: "c.ts", status: "type_changed" },
    ])
  })

  test("parses renames with old + new path", () => {
    const raw = "R100\0src/old.ts\0src/new.ts\0M\0lib.ts\0"
    expect(parseNameStatus(raw)).toEqual([
      { path: "src/new.ts", status: "renamed", oldPath: "src/old.ts" },
      { path: "lib.ts", status: "modified" },
    ])
  })

  test("parses copies with old + new path", () => {
    expect(parseNameStatus("C75\0old.ts\0new.ts\0")).toEqual([
      { path: "new.ts", status: "copied", oldPath: "old.ts" },
    ])
  })

  test("tolerates missing trailing NUL", () => {
    expect(parseNameStatus("M\0src/foo.ts")).toEqual([{ path: "src/foo.ts", status: "modified" }])
  })

  test("classifies unknown status codes as `unknown`", () => {
    expect(parseNameStatus("Z\0weird.ts\0")).toEqual([{ path: "weird.ts", status: "unknown" }])
  })
})

describe("parseUntracked", () => {
  test("returns empty for empty input", () => {
    expect(parseUntracked("")).toEqual([])
  })

  test("parses NUL-separated paths as untracked entries", () => {
    expect(parseUntracked("new1.ts\0dir/new2.ts\0")).toEqual([
      { path: "new1.ts", status: "untracked" },
      { path: "dir/new2.ts", status: "untracked" },
    ])
  })
})

describe("mergeChanges", () => {
  test("dedups by path, preferring the tracked entry", () => {
    const tracked: readonly FileChange[] = [{ path: "a.ts", status: "modified" }]
    const untracked: readonly FileChange[] = [
      { path: "a.ts", status: "untracked" },
      { path: "b.ts", status: "untracked" },
    ]
    expect(mergeChanges(tracked, untracked)).toEqual([
      { path: "a.ts", status: "modified" },
      { path: "b.ts", status: "untracked" },
    ])
  })

  test("sorts alphabetically", () => {
    const tracked: readonly FileChange[] = [
      { path: "z.ts", status: "modified" },
      { path: "a.ts", status: "added" },
    ]
    expect(mergeChanges(tracked, [])).toEqual([
      { path: "a.ts", status: "added" },
      { path: "z.ts", status: "modified" },
    ])
  })
})

describe("truncateDiff", () => {
  test("passes through small payloads untouched", () => {
    expect(truncateDiff("short")).toEqual({ diff: "short", truncated: false })
  })

  test("truncates when over the cap and flags it", () => {
    const big = "a".repeat(MAX_DIFF_BYTES + 10)
    const out = truncateDiff(big)
    expect(out.truncated).toBe(true)
    expect(out.diff.length).toBe(MAX_DIFF_BYTES)
  })

  test("respects a custom max", () => {
    expect(truncateDiff("hello", 3)).toEqual({ diff: "hel", truncated: true })
  })
})
