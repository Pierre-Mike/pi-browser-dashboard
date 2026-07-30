import { describe, expect, it } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { THEME_GATE_FILES, themeCheckArgv } from "./theme-check.core"

const WEB = join(import.meta.dir, "..", "apps", "web")

describe("theme:check names four files that exist", () => {
  // The reason this file exists. `bun test <path>` filters rather than resolves,
  // so a stale path makes the runner quietly narrow instead of fail — the same
  // fail-open shape the harness doctor exists to prevent, one layer down.
  for (const file of THEME_GATE_FILES) {
    it(`${file} is on disk`, () => {
      expect(
        existsSync(join(WEB, file)),
        `apps/web/${file} is gone — fix theme-check.core.ts`,
      ).toBe(true)
    })
  }

  it("covers both halves of a theme change: the config and the terminal pane", () => {
    // A family is two edits that can disagree — the daisyUI tokens in
    // tailwind.config.js and the xterm palette keyed by theme name — and the
    // cursor/pane rules are the ones that tie them together. A subset that
    // dropped either half would be a loop that cannot see half its own work.
    expect(THEME_GATE_FILES).toContain("src/lib/ui/themeCatalog.test.ts")
    expect(THEME_GATE_FILES).toContain("src/features/terminal/terminalTheme.test.ts")
  })

  it("stays a subset — the loop is cheap because it is small", () => {
    expect(THEME_GATE_FILES.length).toBe(4)
    expect(new Set(THEME_GATE_FILES).size).toBe(THEME_GATE_FILES.length)
  })
})

describe("themeCheckArgv", () => {
  it("runs bun test over exactly the files it is given", () => {
    expect(themeCheckArgv({ files: ["a.test.ts", "b.test.ts"] })).toEqual([
      "bun",
      "test",
      "a.test.ts",
      "b.test.ts",
    ])
  })

  it("adds no name filter, so the shared contrast loops always run", () => {
    // `-t <family>` looks like a free narrowing and is not: every contrast floor
    // is one test that loops over all eighteen themes, so a name filter skips the
    // assertions a new hex breaks. See the comment on themeCheckArgv.
    expect(themeCheckArgv({ files: THEME_GATE_FILES })).not.toContain("-t")
  })
})
