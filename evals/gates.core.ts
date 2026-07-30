/**
 * Which gates judge an eval cell — PURE, and *derived* rather than listed.
 *
 * The gate jury is "whatever `bun run verify` runs", read out of package.json at
 * run time instead of hardcoded in the runner. The repo already learned this
 * lesson twice (scripts/typecheck.ts and scripts/check-axiom-debt.ts derive
 * their scope from `workspaces` for the same reason): a hand-maintained list
 * inside the harness fails *open*. Add a gate to `verify` and forget the
 * runner's copy, and the grid would keep scoring agents against the old,
 * weaker jury while CI enforced the new one.
 */

/** `bun run x && bun run y` -> ["x", "y"], in order, without duplicates. */
const RUN_STEP = /bun\s+run\s+([A-Za-z0-9:_-]+)/g

export const gatesFromVerify = (input: {
  readonly verifyScript: string | undefined
  readonly fallback?: ReadonlyArray<string>
}): ReadonlyArray<string> => {
  const found = [...(input.verifyScript ?? "").matchAll(RUN_STEP)].map((match) => match[1] ?? "")
  const gates = [...new Set(found.filter((name) => name.length > 0))]
  return gates.length > 0 ? gates : (input.fallback ?? [])
}

/**
 * `verify` composes the whole gate chain, so a cell that ran it as one command
 * would collapse seven independent signals into one bit. The grid runs each
 * step separately to see *which* axiom an agent broke — hence this exclusion.
 */
export const isSelfReferential = (gate: string): boolean => gate === "verify"

export const gatesOf = (input: {
  readonly scripts: Readonly<Record<string, string>>
  readonly fallback?: ReadonlyArray<string>
}): ReadonlyArray<string> =>
  gatesFromVerify({ verifyScript: input.scripts.verify, fallback: input.fallback }).filter(
    (gate) => !isSelfReferential(gate) && input.scripts[gate] !== undefined,
  )
