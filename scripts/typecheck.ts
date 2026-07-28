#!/usr/bin/env bun
/**
 * Gate: `tsc --noEmit` over every workspace.
 *
 * Discovery-based on purpose. A hand-maintained list of projects (a root
 * tsconfig's `references`, or a chain of `&&` in package.json) fails *open*:
 * add an app, forget the list, and the app is silently never type-checked.
 * Here the workspace set comes from the filesystem — every `apps/*` directory
 * with a package.json — and a workspace *without* a tsconfig.json is an error,
 * not a skip. Adding an app therefore either joins the gate or breaks it.
 */
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dir, "..")
const appsDir = join(root, "apps")

type Workspace = { readonly name: string; readonly dir: string }

const workspaces: Workspace[] = readdirSync(appsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => ({ name: e.name, dir: join(appsDir, e.name) }))
  .filter((w) => existsSync(join(w.dir, "package.json")))
  .sort((a, b) => a.name.localeCompare(b.name))

const untyped = workspaces.filter((w) => !existsSync(join(w.dir, "tsconfig.json")))
if (untyped.length > 0) {
  console.error("✖ workspace without a tsconfig.json — it would escape the typecheck gate:")
  for (const w of untyped) console.error(`  apps/${w.name}`)
  console.error("  Add apps/<name>/tsconfig.json extending ../../tsconfig.base.json.")
  process.exit(1)
}

const failed: string[] = []
for (const w of workspaces) {
  console.error(`— tsc apps/${w.name}`)
  const proc = Bun.spawnSync(["bunx", "tsc", "-p", "tsconfig.json", "--noEmit"], {
    cwd: w.dir,
    stdout: "inherit",
    stderr: "inherit",
  })
  if (proc.exitCode !== 0) failed.push(`apps/${w.name}`)
}

// Repo-level TypeScript that ships no app: the gate scripts themselves.
console.error("— tsc scripts")
const scriptsProc = Bun.spawnSync(["bunx", "tsc", "-p", "tsconfig.json", "--noEmit"], {
  cwd: join(root, "scripts"),
  stdout: "inherit",
  stderr: "inherit",
})
if (scriptsProc.exitCode !== 0) failed.push("scripts")

if (failed.length > 0) {
  console.error(`✖ typecheck failed: ${failed.join(", ")}`)
  process.exit(1)
}
console.error(`✓ typecheck clean across ${workspaces.length} workspaces + scripts`)
