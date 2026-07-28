#!/usr/bin/env bun
/**
 * Gate: every functional core has a co-located test, and no unit test hides in
 * a mirrored test directory.
 *
 * "Co-located tests" is an axiom; this makes it enforced rather than
 * documented. It is scoped to file *shape* (`**\/*.core.ts`), not to a path, so
 * renaming or adding an app cannot make the rule quietly stop applying.
 *
 * Complements scripts/check-feature-tests.sh: that one asserts a whole feature
 * folder ships some test; this one asserts each individual pure core does.
 */
import { existsSync } from "node:fs"
import { join } from "node:path"
import { Glob } from "bun"

const root = join(import.meta.dir, "..")
const SKIP = ["node_modules", ".stryker-tmp", "dist", "dist-web", ".claude/worktrees"]
const skip = (file: string): boolean => SKIP.some((s) => file.includes(s))

const missing: string[] = []
for await (const file of new Glob("**/*.core.{ts,tsx}").scan({ cwd: root })) {
  if (skip(file) || /\.test\.tsx?$/.test(file)) continue
  const testFile = file.replace(/\.core\.(ts|tsx)$/, ".core.test.$1")
  if (!existsSync(join(root, testFile))) missing.push(`${file} -> expected ${testFile}`)
}

// A Playwright suite's `tests/` directory is the framework's own layout, not a
// mirrored unit-test tree — and it has no source to sit beside, since it drives
// the app from outside. Detect those roots by the config file rather than by
// hard-coding apps/e2e, so a second e2e workspace is recognised automatically.
const e2eRoots: string[] = []
for await (const config of new Glob("**/playwright.config.ts").scan({ cwd: root })) {
  if (skip(config)) continue
  e2eRoots.push(config.replace(/playwright\.config\.ts$/, ""))
}

const mirrored: string[] = []
for await (const file of new Glob("**/{__tests__,test,tests}/**/*.{test,spec}.{ts,tsx}").scan({
  cwd: root,
})) {
  if (skip(file) || e2eRoots.some((r) => file.startsWith(r))) continue
  mirrored.push(file)
}

if (missing.length > 0) {
  console.error("✖ cores without a co-located test (ts-axioms: co-located tests):")
  for (const m of missing) console.error(`  ${m}`)
}
if (mirrored.length > 0) {
  console.error("✖ tests in a mirrored test directory — move them next to their source:")
  for (const m of mirrored) console.error(`  ${m}`)
}
if (missing.length > 0 || mirrored.length > 0) process.exit(1)

console.error("✓ every *.core.ts has a co-located *.core.test.ts; no mirrored test dirs")
