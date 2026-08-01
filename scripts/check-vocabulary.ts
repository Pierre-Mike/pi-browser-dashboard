#!/usr/bin/env bun
/**
 * vocabulary — the `_Avoid_` lists in every `## Domain` section, enforced.
 *
 *   bun run vocabulary                    # full sweep (CI + `bun run test`)
 *   bun run scripts/check-vocabulary.ts --staged <files…>   # pre-commit
 *   bun run scripts/check-vocabulary.ts --list              # show the vocabulary
 *
 * `AGENTS.md`'s glossary was written with every avoided word verified absent
 * from the tree, so this gate starts green: a hit is a regression, never a
 * backlog someone learns to scroll past. Same shape as the axiom ratchet.
 *
 * Decisions live in `scripts/vocabulary.core.ts`; this file reads git and disk.
 */
import { execSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { isAbsolute, relative, resolve } from "node:path"
import type { Violation, VocabRule } from "./vocabulary.core"
import {
  checkContent,
  formatRule,
  formatViolation,
  isLintable,
  parseRules,
} from "./vocabulary.core"

const root = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim()

const git = (args: string): readonly string[] =>
  execSync(`git ${args}`, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
    .split("\n")
    .filter((line) => line.length > 0)

/**
 * Glossaries are discovered, never listed. A hand-maintained list inside the
 * checker would fail open exactly where the checker exists to hold — a new
 * per-directory AGENTS.md would silently enforce nothing.
 */
const loadRules = (): readonly VocabRule[] =>
  git("ls-files '*AGENTS.md' '*CLAUDE.md'").flatMap((file) =>
    parseRules({ markdown: readFileSync(resolve(root, file), "utf8"), sourceFile: file }),
  )

const toRepoRelative = (file: string): string => (isAbsolute(file) ? relative(root, file) : file)

const printList = (rules: readonly VocabRule[]): number => {
  if (rules.length === 0) console.error("No _Avoid_ entries in any ## Domain section.")
  for (const rule of rules) console.error(formatRule(rule))
  return 0
}

/**
 * A staged path can name a file the working tree no longer has — the old half
 * of a rename. Skipping it beats failing the commit on a file being removed.
 */
const readIfPresent = (file: string): string | null => {
  try {
    return readFileSync(resolve(root, file), "utf8")
  } catch {
    return null
  }
}

const targetsFor = (argv: readonly string[]): readonly string[] =>
  (argv.includes("--all") ? git("ls-files") : argv.filter((arg) => !arg.startsWith("--")))
    .map(toRepoRelative)
    .filter(isLintable)

const scan = ({
  targets,
  rules,
}: {
  readonly targets: readonly string[]
  readonly rules: readonly VocabRule[]
}): readonly Violation[] =>
  targets.flatMap((file) => {
    const content = readIfPresent(file)
    return content === null ? [] : checkContent({ file, content, rules })
  })

const report = (violations: readonly Violation[]): number => {
  if (violations.length === 0) return 0
  console.error(`✖ vocabulary: ${violations.length} use(s) of a term the glossary refuses\n`)
  for (const violation of violations) console.error(`    ${formatViolation(violation)}`)
  console.error("\n  The ## Domain section names the term to use instead. If the glossary is the")
  console.error("  side that is wrong, change it there — do not work around this gate.")
  return 1
}

const main = (): number => {
  const argv = process.argv.slice(2)
  const rules = loadRules()
  if (argv.includes("--list")) return printList(rules)
  // No rules is not an error: a repo may keep a glossary with nothing refused
  // yet. The gate has nothing to say until a term earns an `_Avoid_` list.
  if (rules.length === 0) return 0
  return report(scan({ targets: targetsFor(argv), rules }))
}

process.exit(main())
