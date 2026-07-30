#!/usr/bin/env bun
/**
 * Gate: `tsc --noEmit` over every workspace.
 *
 * Discovery-based on purpose. A hand-maintained list of projects (a root
 * tsconfig's `references`, or a chain of `&&` in package.json) fails *open*:
 * add an app, forget the list, and the app is silently never type-checked.
 *
 * The workspace set is derived from the one list that already has to be right
 * for `bun install` to work — root `package.json` `workspaces` — rather than
 * from a hardcoded `apps/*` scan. That distinction matters: `shared/` is a
 * workspace but not an app, and under an `apps/*` scan it would have escaped
 * the gate entirely. Whatever you must add to `workspaces` to make the repo
 * install, you cannot avoid adding to the typecheck.
 *
 * A discovered workspace *without* a tsconfig.json is an error, not a skip.
 */
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { expandWorkspacePattern, parseWorkspacePatterns } from "./workspaces.core"

const root = join(import.meta.dir, "..")

type Project = { readonly label: string; readonly dir: string }

/** Directory names under a glob's parent — the impure half of the expansion. */
const entriesUnder = (pattern: string): readonly string[] => {
  if (!pattern.endsWith("/*")) return []
  const parent = join(root, pattern.slice(0, -2))
  if (!existsSync(parent)) return []
  return readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
}

const patterns = parseWorkspacePatterns({ pkg: await Bun.file(join(root, "package.json")).json() })
if (patterns.length === 0) {
  console.error("✖ root package.json declares no usable `workspaces` — nothing to typecheck")
  process.exit(1)
}

const workspaces: Project[] = patterns
  .flatMap((pattern) => expandWorkspacePattern({ pattern, entries: entriesUnder(pattern) }))
  .filter((label) => existsSync(join(root, label, "package.json")))
  .map((label) => ({ label, dir: join(root, label) }))
  .sort((a, b) => a.label.localeCompare(b.label))

const untyped = workspaces.filter((w) => !existsSync(join(w.dir, "tsconfig.json")))
if (untyped.length > 0) {
  console.error("✖ workspace without a tsconfig.json — it would escape the typecheck gate:")
  for (const w of untyped) console.error(`  ${w.label}`)
  console.error("  Add <workspace>/tsconfig.json extending the repo's tsconfig.base.json.")
  process.exit(1)
}

// Repo-level TypeScript that ships no workspace: the gate scripts themselves,
// and the eval harness that grades agents against those gates.
const targets: readonly Project[] = [
  ...workspaces,
  { label: "scripts", dir: join(root, "scripts") },
  { label: "evals", dir: join(root, "evals") },
]

const failed: string[] = []
for (const target of targets) {
  console.error(`— tsc ${target.label}`)
  const proc = Bun.spawnSync(["bunx", "tsc", "-p", "tsconfig.json", "--noEmit"], {
    cwd: target.dir,
    stdout: "inherit",
    stderr: "inherit",
  })
  if (proc.exitCode !== 0) failed.push(target.label)
}

if (failed.length > 0) {
  console.error(`✖ typecheck failed: ${failed.join(", ")}`)
  process.exit(1)
}
console.error(
  `✓ typecheck clean across ${targets.length} projects (${targets.map((t) => t.label).join(", ")})`,
)
