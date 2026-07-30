#!/usr/bin/env bun
/**
 * Ratchet gate for the axioms this repo still owes debt on. See
 * scripts/axiom-debt.core.ts for why these three are ratcheted instead of
 * lint-enforced.
 *
 *   bun run axiom-debt          # check against scripts/axiom-debt.json
 *   bun run axiom-debt:update   # re-record the baseline after paying debt down
 *
 * Any drift fails — a new violation *and* a fixed one. Fixing debt is meant to
 * show up as a smaller number committed alongside the fix.
 */
import { join } from "node:path"
import { Glob } from "bun"
import {
  type DebtBaseline,
  diffDebt,
  type SourceFile,
  scanDebt,
  totalDebt,
} from "./axiom-debt.core"
import { parseWorkspacePatterns, workspaceScanRoots } from "./workspaces.core"

const root = join(import.meta.dir, "..")
const baselineFile = join(import.meta.dir, "axiom-debt.json")
const update = process.argv.includes("--update")

const SKIP = [
  "node_modules",
  "/dist/",
  "/dist-web/",
  ".stryker-tmp",
  ".claude/worktrees",
  "routeTree.gen.ts",
]

/**
 * The scanned roots come from root `package.json` `workspaces` plus `scripts`,
 * not from a hardcoded `{apps,scripts}` glob. A hardcoded glob fails open: when
 * `shared/` was added as a workspace it would have been exempt from the ratchet
 * on day one, so the first raw `fetch` written there would have been invisible.
 * Anything you must declare as a workspace to make it install is scanned.
 */
const scanRoots = async (): Promise<readonly string[]> => {
  const patterns = parseWorkspacePatterns({
    pkg: await Bun.file(join(root, "package.json")).json(),
  })
  return workspaceScanRoots({ patterns, extra: ["scripts"] })
}

const collect = async (): Promise<readonly SourceFile[]> => {
  const files: SourceFile[] = []
  for (const dir of await scanRoots()) {
    for await (const rel of new Glob(`${dir}/**/*.{ts,tsx}`).scan({ cwd: root })) {
      const path = rel.replaceAll("\\", "/")
      if (SKIP.some((s) => `/${path}`.includes(s))) continue
      files.push({ path, text: await Bun.file(join(root, path)).text() })
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path))
  return files
}

const actual = scanDebt(await collect())

if (update) {
  await Bun.write(baselineFile, `${JSON.stringify(actual, null, 2)}\n`)
  console.error(`✓ axiom-debt baseline updated: ${totalDebt(actual)} known violations`)
  process.exit(0)
}

const baseline = (await Bun.file(baselineFile)
  .json()
  .catch(() => null)) as DebtBaseline | null
if (baseline === null) {
  console.error(`✖ missing ${baselineFile} — run: bun run axiom-debt:update`)
  process.exit(1)
}

const drift = diffDebt({ baseline, actual })
if (drift.length === 0) {
  console.error(`✓ axiom debt unchanged: ${totalDebt(actual)} known violations, none new`)
  process.exit(0)
}

const added = drift.filter((d) => d.actual > d.baseline)
const paid = drift.filter((d) => d.actual < d.baseline)

if (added.length > 0) {
  console.error("✖ new axiom violations — these are not allowed to grow:")
  for (const d of added) {
    console.error(`  [${d.cls}] ${d.path}: ${d.baseline} -> ${d.actual}`)
  }
  console.error("")
  console.error("  cross-slice-import: import the sibling's <slice>.door.ts — the service Tag it")
  console.error("                      publishes — not its .core / .io / .routes internals.")
  console.error("  env-outside-config: read the environment in platform/config.io.ts and pass")
  console.error("                      values in.")
  console.error("  raw-fetch:          call the typed Hono RPC client, or do the I/O in a *.io.ts.")
}
if (paid.length > 0) {
  console.error(`${added.length > 0 ? "" : "✖ "}axiom debt was paid down — lock it in:`)
  for (const d of paid) {
    console.error(`  [${d.cls}] ${d.path}: ${d.baseline} -> ${d.actual}`)
  }
  console.error("  run: bun run axiom-debt:update && git add scripts/axiom-debt.json")
}
process.exit(1)
