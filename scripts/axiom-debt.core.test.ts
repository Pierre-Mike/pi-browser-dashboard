import { describe, expect, it } from "bun:test"
import {
  countCrossSliceImports,
  countEnvReads,
  countRawFetches,
  diffDebt,
  scanDebt,
  totalDebt,
} from "./axiom-debt.core"

describe("countCrossSliceImports", () => {
  it("counts a hop into a sibling slice's internals", () => {
    const n = countCrossSliceImports({
      path: "apps/daemon/src/features/terminal/terminal.routes.ts",
      text: [
        'import { ProjectsService } from "../projects/projects.io"',
        'import type { SessionState } from "../sessions/sessions.core"',
      ].join("\n"),
    })
    expect(n).toBe(2)
  })

  it("does not count imports inside the same slice", () => {
    const n = countCrossSliceImports({
      path: "apps/daemon/src/features/terminal/terminal.routes.ts",
      text: 'import { x } from "./terminal.core"\nimport { y } from "../terminal/terminal.io"',
    })
    expect(n).toBe(0)
  })

  it("does not count platform imports — platform is a published door", () => {
    const n = countCrossSliceImports({
      path: "apps/daemon/src/features/terminal/terminal.routes.ts",
      text: 'import { appRuntime } from "../../platform/runtime"',
    })
    expect(n).toBe(0)
  })

  it("ignores files outside a feature slice", () => {
    expect(
      countCrossSliceImports({
        path: "apps/daemon/src/api.ts",
        text: 'import { app } from "../other/other.routes"',
      }),
    ).toBe(0)
  })
})

describe("countEnvReads", () => {
  it("counts every process.env read in a slice", () => {
    const n = countEnvReads({
      path: "apps/daemon/src/features/library/library.io.ts",
      text: "const a = process.env.A\nconst b = process.env.B",
    })
    expect(n).toBe(2)
  })

  it("sanctions the config funnel, composition roots, scripts and configs", () => {
    const text = "process.env.PORT"
    for (const path of [
      "apps/daemon/src/platform/config.io.ts",
      "apps/daemon/src/platform/config-dir.ts",
      "apps/daemon/src/main.ts",
      "apps/daemon/src/server.ts",
      "scripts/typecheck.ts",
      "apps/e2e/global-setup.ts",
      "apps/cli/src/main.ts",
      "apps/web/vite.config.ts",
    ]) {
      expect(countEnvReads({ path, text })).toBe(0)
    }
  })

  it("ignores tests — a test may stage the environment it exercises", () => {
    expect(
      countEnvReads({
        path: "apps/daemon/src/features/library/library.io.test.ts",
        text: "process.env.X = '1'",
      }),
    ).toBe(0)
  })
})

describe("countRawFetches", () => {
  it("counts bare fetch calls", () => {
    expect(
      countRawFetches({
        path: "apps/web/src/features/projects/useProjectFiles.ts",
        text: "const a = await fetch(url)\nconst b = await fetch(url2)",
      }),
    ).toBe(2)
  })

  it("does not count a method named fetch on an object", () => {
    expect(
      countRawFetches({
        path: "apps/web/src/features/projects/x.ts",
        text: "Bun.serve({ fetch: app.fetch })\nclient.fetch(url)",
      }),
    ).toBe(0)
  })

  it("sanctions *.io.ts — that is the port where I/O belongs", () => {
    expect(
      countRawFetches({ path: "apps/web/src/features/x/x.io.ts", text: "await fetch(url)" }),
    ).toBe(0)
  })
})

describe("scanDebt / diffDebt / totalDebt", () => {
  const files = [
    {
      path: "apps/daemon/src/features/a/a.routes.ts",
      text: 'import { z } from "../b/b.io"\nconst p = process.env.X',
    },
    { path: "apps/web/src/features/c/c.ts", text: "await fetch(u)" },
  ]

  it("omits zero counts so the baseline stays terse", () => {
    const scan = scanDebt(files)
    expect(scan["cross-slice-import"]).toEqual({
      "apps/daemon/src/features/a/a.routes.ts": 1,
    })
    expect(scan["raw-fetch"]).toEqual({ "apps/web/src/features/c/c.ts": 1 })
    expect(totalDebt(scan)).toBe(3)
  })

  it("reports no drift against its own scan", () => {
    const scan = scanDebt(files)
    expect(diffDebt({ baseline: scan, actual: scan })).toEqual([])
  })

  it("reports a regression when a count grows or a new file appears", () => {
    const drift = diffDebt({
      baseline: { "raw-fetch": { "a.ts": 1 } },
      actual: { "raw-fetch": { "a.ts": 2, "b.ts": 1 } },
    })
    expect(drift).toEqual([
      { cls: "raw-fetch", path: "a.ts", baseline: 1, actual: 2 },
      { cls: "raw-fetch", path: "b.ts", baseline: 0, actual: 1 },
    ])
  })

  it("also reports a repayment, so the win gets locked into the baseline", () => {
    const drift = diffDebt({
      baseline: { "raw-fetch": { "a.ts": 2 } },
      actual: { "raw-fetch": {} },
    })
    expect(drift).toEqual([{ cls: "raw-fetch", path: "a.ts", baseline: 2, actual: 0 }])
  })
})
