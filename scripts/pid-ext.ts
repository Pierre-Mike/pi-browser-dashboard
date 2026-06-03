#!/usr/bin/env bun
/**
 * pid-ext — scaffold a new iframe extension.
 *
 * Usage:
 *   bun run pid-ext <name> [--global|--local] [--tier iframe]
 *
 * Default scope is --local → <cwd>/.pid/extensions/<name>
 * --global         → ~/.pid/extensions/<name>
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import type {
  ScaffoldOptions,
  ScaffoldScope,
  ScaffoldTier,
} from "../apps/daemon/src/platform/extensions/scaffold"
import { buildScaffold } from "../apps/daemon/src/platform/extensions/scaffold"

const args = process.argv.slice(2)

const printUsage = (): void => {
  console.error("Usage: bun run pid-ext <name> [--global|--local] [--tier iframe]")
  console.error("")
  console.error("  --local   Write to <cwd>/.pid/extensions/<name>  (default)")
  console.error("  --global  Write to ~/.pid/extensions/<name>")
  console.error("  --tier    Extension tier (only 'iframe' supported; default: iframe)")
}

if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  printUsage()
  process.exit(args.length === 0 ? 1 : 0)
}

const name = args[0]

let scope: ScaffoldScope = "local"
let tier: ScaffoldTier = "iframe"

for (let i = 1; i < args.length; i++) {
  const arg = args[i]
  if (arg === "--global") {
    scope = "global"
  } else if (arg === "--local") {
    scope = "local"
  } else if (arg === "--tier") {
    const next = args[i + 1]
    if (!next || next.startsWith("--")) {
      console.error("error: --tier requires a value (e.g. --tier iframe)")
      process.exit(1)
    }
    if (next !== "iframe") {
      console.error(`error: unsupported tier "${next}"; only "iframe" is supported`)
      process.exit(1)
    }
    tier = next as ScaffoldTier
    i++
  } else {
    console.error(`error: unknown argument "${arg}"`)
    printUsage()
    process.exit(1)
  }
}

const opts: ScaffoldOptions = { tier, scope }
const result = buildScaffold(name, opts)

if (!result.ok) {
  console.error(`error: ${result.error}`)
  process.exit(1)
}

const baseDir =
  scope === "global"
    ? join(homedir(), ".pid", "extensions")
    : join(process.cwd(), ".pid", "extensions")

const targetDir = join(baseDir, result.dirName)
const absTarget = resolve(targetDir)

// Refuse to overwrite a non-empty directory.
if (existsSync(absTarget)) {
  let entries: string[] = []
  try {
    entries = readdirSync(absTarget)
  } catch {
    // ignore read error; proceed to attempt creation
  }
  if (entries.length > 0) {
    console.error(`error: target directory already exists and is non-empty: ${absTarget}`)
    console.error("Remove it first or choose a different name.")
    process.exit(1)
  }
}

mkdirSync(absTarget, { recursive: true })

for (const file of result.files) {
  const absPath = join(absTarget, file.relPath)
  writeFileSync(absPath, file.content, "utf8")
  console.warn(`created: ${absPath}`)
}

console.warn("")
console.warn(
  "Next: restart the daemon (bun run dev:daemon) then open the Extensions tab in the dashboard.",
)
