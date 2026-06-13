// Pure coercion for tab-selection URL search params. Used by route `validateSearch`
// to turn an untrusted `?tab=` value into a known tab, or `undefined` when it is
// absent/invalid (the route then omits it and the component falls back to its default).

/** Coerce a fixed-enum tab param to a known key, or `undefined` when not recognised. */
export const coerceEnumTab = <T extends string>(raw: unknown, keys: readonly T[]): T | undefined =>
  typeof raw === "string" && (keys as readonly string[]).includes(raw) ? (raw as T) : undefined

/**
 * Coerce a tab param that is either a known static key or a namespaced `ext:<name>`
 * key (extension-contributed tabs), or `undefined` when not recognised.
 */
export const coerceExtTab = <T extends string>(
  raw: unknown,
  staticKeys: readonly T[],
): T | `ext:${string}` | undefined => {
  if (typeof raw !== "string") return undefined
  if ((staticKeys as readonly string[]).includes(raw)) return raw as T
  if (raw.startsWith("ext:") && raw.length > "ext:".length) return raw as `ext:${string}`
  return undefined
}
