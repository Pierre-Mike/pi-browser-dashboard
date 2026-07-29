// Tiny runtime type guards shared by the web-only `*.parse.ts` decoders
// (features whose response shape has no `@pid/shared` contract — see
// scripts/axiom-debt.json's `json-cast` entries). Each guard narrows
// `unknown` without asserting anything the check didn't actually verify, so a
// `*.parse.ts` built from these never needs an `as`.

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

export const isString = (v: unknown): v is string => typeof v === "string"

export const isNumber = (v: unknown): v is number => typeof v === "number"

export const isBoolean = (v: unknown): v is boolean => typeof v === "boolean"

export const isArrayOf = <T>(v: unknown, guard: (item: unknown) => item is T): v is T[] =>
  Array.isArray(v) && v.every(guard)

export const isStringArray = (v: unknown): v is string[] => isArrayOf(v, isString)

// Runs `parseOne` over every element of an unknown array, failing the whole
// list the moment one element doesn't parse — a partially-valid list would
// otherwise silently drop rows a user expects to see.
export const parseArray = <T>(v: unknown, parseOne: (item: unknown) => T | null): T[] | null => {
  if (!Array.isArray(v)) return null
  const out: T[] = []
  for (const item of v) {
    const parsed = parseOne(item)
    if (parsed === null) return null
    out.push(parsed)
  }
  return out
}
