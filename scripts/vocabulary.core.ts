/**
 * The vocabulary gate's decisions — parsing `## Domain` glossaries and matching
 * avoided terms. No I/O: `check-vocabulary.ts` reads git and the filesystem and
 * hands plain strings in.
 *
 * `AGENTS.md`'s `## Domain` section publishes the product's canonical terms and,
 * under each, an `_Avoid_` list of near-synonyms we refuse. That list is only a
 * suggestion until something reads it, which is what this is: the glossary was
 * written with every avoided word verified absent from the tree, so the gate
 * starts green and the first hit is a regression rather than inherited debt.
 *
 * Vendored from the `domain-expertise` skill rather than run from it, because a
 * gate that lives in one contributor's home directory is not a gate. Rewritten
 * on the way in for this repo's rules: single-parameter declarations
 * (`biome-plugins/max-one-param-declarations.grit` binds `scripts/**`), and no
 * `node:path` — git speaks forward slashes on every platform, so the separator
 * is a constant and this core stays free of platform reads.
 */

/** One `_Avoid_` entry: a refused spelling and the term that replaces it. */
export type VocabRule = {
  /** The avoided term, lowercased and normalized to space-separated words. */
  readonly avoid: string
  /** The canonical term, as written in the glossary. */
  readonly canonical: string
  /** Repo-relative directory whose subtree this rule binds; "" is the root. */
  readonly scopeDir: string
  /** Repo-relative path of the AGENTS.md / CLAUDE.md that declared it. */
  readonly sourceFile: string
}

export type Violation = {
  readonly file: string
  readonly line: number
  readonly avoided: string
  readonly canonical: string
  readonly sourceFile: string
}

const SEP = "/"

const CODE_EXTENSIONS: readonly string[] = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".md",
  ".mdx",
  ".sh",
  ".json",
  ".jsonc",
  ".yml",
  ".yaml",
]

/**
 * Files whose whole job is to talk *about* the vocabulary. Excluding them is
 * what lets a glossary name the words it refuses without flagging itself — and
 * it is why a term retired in prose ("the scratch canvas is gone") must never
 * go on an `_Avoid_` list: those sentences live in ordinary files that ARE
 * linted, and a gate that fires on correct prose gets muted within a week.
 */
const EXCLUDED_BASENAMES: ReadonlySet<string> = new Set(["AGENTS.md", "CLAUDE.md"])

const EXCLUDED_PATH_PARTS: readonly string[] = [`docs${SEP}adr${SEP}`, `node_modules${SEP}`]

/**
 * Split camelCase / PascalCase / snake_case / kebab-case into lowercase words,
 * so one `_Avoid_` entry catches every spelling of the same term:
 * `someClientRecord` and `some_client_record` both become "some client record".
 */
const normalizeIdentifiers = (text: string): string =>
  text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .toLowerCase()
    .trim()

/** The body of a markdown file's `## Domain` section, or null if it has none. */
const extractDomainSection = (markdown: string): string | null => {
  const match = markdown.match(/^## Domain\s*$/m)
  if (match?.index === undefined) return null
  const rest = markdown.slice(match.index + match[0].length)
  const next = rest.search(/^## (?!#)/m)
  return next === -1 ? rest : rest.slice(0, next)
}

const dirOf = (file: string): string => {
  const cut = file.lastIndexOf(SEP)
  return cut === -1 ? "" : file.slice(0, cut)
}

const isPresent = (value: string | null): value is string => value !== null

/** The canonical term a `**Order**:` line declares, or null for any other line. */
const termOf = (line: string): string | null =>
  line.match(/^\*\*(.+?)\*\*\s*:/)?.[1]?.trim() ?? null

/** The normalized words an `_Avoid_: a, b` line refuses; empty for other lines. */
const avoidedOf = (line: string): readonly string[] =>
  (line.match(/^_Avoid_\s*:\s*(.+)$/i)?.[1] ?? "")
    .split(",")
    .map(normalizeIdentifiers)
    .filter((word) => word.length > 0)

/** Drop everything before the first term, so a stray `_Avoid_` has no owner. */
const fromFirstTerm = (lines: readonly string[]): readonly string[] => {
  const first = lines.findIndex((line) => termOf(line) !== null)
  return first === -1 ? [] : lines.slice(first)
}

/** Every (canonical term, avoided word) pair the section declares, in order. */
const avoidPairs = (section: string): readonly (readonly [string, string])[] => {
  const pairs: (readonly [string, string])[] = []
  let current = ""
  for (const line of fromFirstTerm(section.split("\n"))) {
    const term = termOf(line)
    if (term !== null) current = term
    else for (const avoid of avoidedOf(line)) pairs.push([current, avoid])
  }
  return pairs
}

/**
 * Parse one glossary file into rules. Terms are `**Order**:`; avoided lists are
 * `_Avoid_: a, b` beneath the term they belong to.
 *
 * An avoided word that is also a term name is a glossary mistake — it would
 * flag every correct use of the canonical term — so the rule is dropped rather
 * than allowed to turn the gate into noise. `--list` then shows the term with
 * no rule beside it, which is the visible symptom.
 */
export const parseRules = ({
  markdown,
  sourceFile,
}: {
  readonly markdown: string
  readonly sourceFile: string
}): readonly VocabRule[] => {
  const section = extractDomainSection(markdown)
  if (section === null) return []
  const scopeDir = dirOf(sourceFile)
  const termNames = new Set(
    section.split("\n").map(termOf).filter(isPresent).map(normalizeIdentifiers),
  )
  return avoidPairs(section)
    .map(([canonical, avoid]) => ({ avoid, canonical, scopeDir, sourceFile }))
    .filter((rule) => !termNames.has(rule.avoid))
}

/**
 * An `_Avoid_` list binds the subtree of the file that declares it, so the same
 * word may mean different things in two contexts. Root entries bind everything.
 */
const inScope = ({
  file,
  scopeDir,
}: {
  readonly file: string
  readonly scopeDir: string
}): boolean => scopeDir === "" || file === scopeDir || file.startsWith(scopeDir + SEP)

export const isLintable = (file: string): boolean => {
  const base = file.split(SEP).pop() ?? file
  if (EXCLUDED_BASENAMES.has(base)) return false
  if (EXCLUDED_PATH_PARTS.some((part) => (file + SEP).includes(part))) return false
  return CODE_EXTENSIONS.some((ext) => file.endsWith(ext))
}

/**
 * Every avoided term one line uses. A glossary's own `_Avoid_` line names the
 * words it refuses, so it is skipped here by shape rather than only by
 * basename — that keeps the gate honest if a per-directory glossary is ever
 * copied into a file that IS linted.
 */
const violationsInLine = ({
  file,
  line,
  lineNumber,
  rules,
}: {
  readonly file: string
  readonly line: string
  readonly lineNumber: number
  readonly rules: readonly VocabRule[]
}): readonly Violation[] => {
  if (/_Avoid_\s*:/i.test(line)) return []
  const normalized = ` ${normalizeIdentifiers(line)} `
  return rules
    .filter((rule) => normalized.includes(` ${rule.avoid} `))
    .map((rule) => ({
      file,
      line: lineNumber,
      avoided: rule.avoid,
      canonical: rule.canonical,
      sourceFile: rule.sourceFile,
    }))
}

/** Every avoided term used in one file, with the line that used it. */
export const checkContent = ({
  file,
  content,
  rules,
}: {
  readonly file: string
  readonly content: string
  readonly rules: readonly VocabRule[]
}): readonly Violation[] => {
  const applicable = rules.filter((rule) => inScope({ file, scopeDir: rule.scopeDir }))
  if (applicable.length === 0) return []
  return content
    .split("\n")
    .flatMap((line, index) =>
      violationsInLine({ file, line, lineNumber: index + 1, rules: applicable }),
    )
}

export const formatViolation = (violation: Violation): string =>
  `${violation.file}:${violation.line}  "${violation.avoided}" → use "${violation.canonical}"  (${violation.sourceFile})`

export const formatRule = (rule: VocabRule): string =>
  `"${rule.avoid}" → ${rule.canonical}  [scope: ${rule.scopeDir === "" ? "(repo root)" : rule.scopeDir}, from ${rule.sourceFile}]`
