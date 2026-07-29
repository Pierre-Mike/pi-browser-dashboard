/**
 * Parse the `workspaces` field of a root package.json — PURE.
 *
 * Three gates now derive their scope from this one list (`typecheck.ts`,
 * `check-axiom-debt.ts`, `check-harness.ts`), so it is worth *reading* rather
 * than asserting. A type assertion on the parsed file would compile forever
 * against a `workspaces` that had become a string, an object, or absent, and the
 * gate would then quietly scan nothing — exactly the fail-open behaviour that
 * deriving from `workspaces` was meant to remove.
 *
 * Malformed input yields an empty list rather than a throw (core discipline);
 * each caller treats "no workspaces" as a hard error, so nothing is silently
 * skipped.
 */

/** The raw `workspaces` value, or `undefined` when the field is absent. */
const workspacesField = (pkg: unknown): unknown => {
  if (typeof pkg !== "object" || pkg === null) return undefined
  if (!("workspaces" in pkg)) return undefined
  return pkg.workspaces
}

export const parseWorkspacePatterns = (input: { readonly pkg: unknown }): readonly string[] => {
  const raw = workspacesField(input.pkg)
  if (!Array.isArray(raw)) return []
  return raw.filter((pattern): pattern is string => typeof pattern === "string")
}

/**
 * Expand one pattern to the directory names it selects, given the entries of its
 * parent directory. Only the trailing `/*` form is supported — the only glob bun
 * workspaces actually use here — and anything else is treated as a literal path.
 *
 * Kept pure (directory entries in, paths out) so the walk is testable without a
 * filesystem; the callers do the `readdir`.
 */
export const expandWorkspacePattern = (input: {
  readonly pattern: string
  readonly entries: readonly string[]
}): readonly string[] => {
  if (!input.pattern.endsWith("/*")) return [input.pattern]
  const parent = input.pattern.slice(0, -2)
  return input.entries.map((entry) => `${parent}/${entry}`)
}

/** The directory prefixes a pattern set covers, with globs collapsed to parents. */
export const workspaceScanRoots = (input: {
  readonly patterns: readonly string[]
  readonly extra: readonly string[]
}): readonly string[] => {
  const roots = input.patterns.map((p) => (p.endsWith("/*") ? p.slice(0, -2) : p))
  return [...new Set([...roots, ...input.extra])].sort()
}
