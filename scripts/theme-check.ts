#!/usr/bin/env bun
/**
 * theme:check — the four test files a theme change has to satisfy.
 *
 * `bun run theme:check`
 *
 * The hex-hunting loop for a new family used to run `bun run verify`: six
 * typecheck projects, ~3,500 tests, `fallow audit` and the debt ratchet, to
 * answer a question four files answer by themselves. This is that subset. It is
 * not a gate — `bun run test:web` still runs all of them in CI — it is the loop
 * you run twenty times while moving a hue.
 *
 * `scripts/theme-check.core.ts` owns the list and the argv; this file does the
 * I/O.
 */
import { existsSync } from "node:fs"
import { join } from "node:path"
import { THEME_GATE_FILES, themeCheckArgv } from "./theme-check.core"

const root = join(import.meta.dir, "..")
const web = join(root, "apps/web")

// `bun test <path>` filters rather than resolves, so a missing file narrows the
// run instead of failing it. Refuse up front with the path named, rather than
// reporting green over three files. (theme-check.core.test.ts asserts the same
// thing inside `bun run test`, so CI notices even if nobody runs this.)
const missing = THEME_GATE_FILES.filter((file) => !existsSync(join(web, file)))
if (missing.length > 0) {
  console.error(`✖ theme:check names ${missing.length} file(s) that no longer exist:`)
  for (const file of missing) console.error(`    apps/web/${file}`)
  console.error("  Fix the list in scripts/theme-check.core.ts.")
  process.exit(1)
}

const argv = themeCheckArgv({ files: THEME_GATE_FILES })
const proc = Bun.spawnSync(argv as string[], { cwd: web, stdout: "inherit", stderr: "inherit" })
process.exit(proc.exitCode ?? 1)
