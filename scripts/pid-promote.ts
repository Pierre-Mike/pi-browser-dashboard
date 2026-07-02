#!/usr/bin/env bun
/**
 * pid-promote — move an existing pid-app into the extension platform.
 *
 * Usage:
 *   bun run pid-promote <id>
 *
 * Moves <cwd>/.pid/<id>/ to <cwd>/.pid/extensions/<id>/ and writes a
 * generated manifest.json alongside the app's existing files. pid-apps are
 * always per-project, so this always operates relative to cwd — there is no
 * --global/--local flag here (contrast pid-ext, which scaffolds fresh and
 * supports both scopes).
 */
import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { buildManifestJson, validateName } from "../apps/daemon/src/platform/extensions/scaffold"

const args = process.argv.slice(2)

const printUsage = (): void => {
  console.error("Usage: bun run pid-promote <id>")
  console.error("")
  console.error("  Moves <cwd>/.pid/<id>/ into <cwd>/.pid/extensions/<id>/")
  console.error("  and generates a manifest.json for it.")
}

if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  printUsage()
  process.exit(args.length === 0 ? 1 : 0)
}

const id = args[0]

const nameError = validateName(id)
if (nameError) {
  console.error(`error: ${nameError}`)
  process.exit(1)
}

if (id === "default") {
  console.error(
    "error: the bare-root default app has no dedicated folder to promote — create a named app first",
  )
  process.exit(1)
}

const cwd = process.cwd()
const sourceDir = resolve(join(cwd, ".pid", id))

if (!existsSync(join(sourceDir, "index.html"))) {
  console.error(
    `error: ${join(".pid", id, "index.html")} does not exist — "${id}" is not a pid-app`,
  )
  process.exit(1)
}

const extensionsDir = join(cwd, ".pid", "extensions")
const targetDir = join(extensionsDir, id)
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

mkdirSync(extensionsDir, { recursive: true })

// One atomic move of the whole directory — carries along any sibling assets
// (images, scripts, etc.) automatically. Do not copy file-by-file.
renameSync(sourceDir, absTarget)
console.warn(`moved: ${sourceDir} -> ${absTarget}`)

const manifestContent = buildManifestJson(id)
const manifestPath = join(absTarget, "manifest.json")
writeFileSync(manifestPath, manifestContent, "utf8")
console.warn(`created: ${manifestPath}`)

console.warn("")
console.warn(
  "Next: restart the daemon (bun run dev:daemon) then open the Extensions tab in the dashboard.",
)
console.warn(
  `Note: the old pidapp:${id} tab is gone now (the directory moved) — it won't reappear as an extension until the daemon restarts and it's enabled.`,
)
