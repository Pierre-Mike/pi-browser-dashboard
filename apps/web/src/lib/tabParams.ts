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

/**
 * Coerce a tab param that is a known static key OR carries one of the allowed
 * namespace prefixes (each prefix must be followed by a non-empty id). Used by
 * routes whose tabs mix static keys with dynamic families (`ext:<name>`,
 * `pidapp:<id>`, `brainstorm:<id>`) so deep links to a dynamic tab survive
 * `validateSearch` instead of being silently dropped.
 */
export const coerceNamespacedTab = <T extends string, P extends string>(
  raw: unknown,
  allowed: { readonly staticKeys: readonly T[]; readonly prefixes: readonly P[] },
): T | `${P}${string}` | undefined => {
  if (typeof raw !== "string") return undefined
  if ((allowed.staticKeys as readonly string[]).includes(raw)) return raw as T
  for (const p of allowed.prefixes) {
    if (raw.startsWith(p) && raw.length > p.length) return raw as `${P}${string}`
  }
  return undefined
}
