import { describe, expect, test } from "bun:test"
import { parseUnifiedDiff, summarizeDiff } from "./diffParse"

const DIFF_SINGLE = `diff --git a/apps/foo.ts b/apps/foo.ts
index 1111111..2222222 100644
--- a/apps/foo.ts
+++ b/apps/foo.ts
@@ -1,3 +1,3 @@
-const x = 1
+const x = 2
 const y = 3
`

const DIFF_TWO_FILES = `diff --git a/apps/foo.ts b/apps/foo.ts
index 1111111..2222222 100644
--- a/apps/foo.ts
+++ b/apps/foo.ts
@@ -1 +1 @@
-old
+new
diff --git a/apps/bar.ts b/apps/bar.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/apps/bar.ts
@@ -0,0 +1 @@
+hello
`

const DIFF_RENAME = `diff --git a/old.ts b/new.ts
similarity index 80%
rename from old.ts
rename to new.ts
index 1111111..2222222 100644
--- a/old.ts
+++ b/new.ts
@@ -1 +1 @@
-a
+b
`

describe("parseUnifiedDiff", () => {
  test("returns empty for empty input", () => {
    expect(parseUnifiedDiff("")).toEqual([])
  })

  test("parses a single-file diff with one hunk", () => {
    const files = parseUnifiedDiff(DIFF_SINGLE)
    expect(files).toHaveLength(1)
    const f = files[0]
    if (!f) throw new Error("missing file 0")
    expect(f.path).toBe("apps/foo.ts")
    const additions = f.lines.filter((l) => l.kind === "addition" && !l.text.startsWith("+++"))
    const deletions = f.lines.filter((l) => l.kind === "deletion" && !l.text.startsWith("---"))
    expect(additions.map((l) => l.text)).toEqual(["+const x = 2"])
    expect(deletions.map((l) => l.text)).toEqual(["-const x = 1"])
    const hunks = f.lines.filter((l) => l.kind === "hunk")
    expect(hunks).toHaveLength(1)
  })

  test("splits a multi-file diff into per-file blocks", () => {
    const files = parseUnifiedDiff(DIFF_TWO_FILES)
    expect(files.map((f) => f.path)).toEqual(["apps/foo.ts", "apps/bar.ts"])
    expect(
      files[1]?.lines.some((l) => l.text === "new file mode 100644" && l.kind === "meta"),
    ).toBe(true)
  })

  test("captures rename metadata as old/new paths", () => {
    const files = parseUnifiedDiff(DIFF_RENAME)
    expect(files).toHaveLength(1)
    const f = files[0]
    if (!f) throw new Error("missing file 0")
    expect(f.oldPath).toBe("old.ts")
    expect(f.newPath).toBe("new.ts")
    expect(f.path).toBe("new.ts")
  })

  test("exposes each file's own block as a self-contained `raw` patch", () => {
    const files = parseUnifiedDiff(DIFF_TWO_FILES)
    expect(files).toHaveLength(2)
    for (const f of files) {
      // Each block must start at its own `diff --git` header and contain
      // exactly one — so @pierre/diffs' PatchDiff sees a single-file patch.
      expect(f.raw.startsWith("diff --git ")).toBe(true)
      expect(f.raw.match(/^diff --git /gm)).toHaveLength(1)
    }
    expect(files[0]?.raw).toBe(
      [
        "diff --git a/apps/foo.ts b/apps/foo.ts",
        "index 1111111..2222222 100644",
        "--- a/apps/foo.ts",
        "+++ b/apps/foo.ts",
        "@@ -1 +1 @@",
        "-old",
        "+new",
        "",
      ].join("\n"),
    )
  })

  test("flags `index`, `new file mode`, and `Binary files` as meta lines", () => {
    const diff = `diff --git a/b.bin b/b.bin
new file mode 100644
index 0000000..ffffff
Binary files /dev/null and b/b.bin differ
`
    const files = parseUnifiedDiff(diff)
    const kinds = files[0]?.lines.map((l) => l.kind) ?? []
    expect(kinds).toEqual(["header", "meta", "meta", "meta"])
  })
})

describe("summarizeDiff", () => {
  test("counts additions and deletions, excluding +++/--- header lines", () => {
    const out = summarizeDiff(parseUnifiedDiff(DIFF_TWO_FILES))
    expect(out).toEqual({ additions: 2, deletions: 1 })
  })

  test("returns zeros for an empty diff list", () => {
    expect(summarizeDiff([])).toEqual({ additions: 0, deletions: 0 })
  })
})
