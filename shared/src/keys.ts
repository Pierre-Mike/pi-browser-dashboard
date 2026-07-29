/**
 * The named-key vocabulary — the safe, documented subset of keystrokes
 * `POST /sessions/:id/keys` accepts, so a caller can send `escape` or
 * `shift-tab` without hand-encoding control sequences.
 *
 * This is a wire contract (an agent writes these names into a request body), and
 * it was previously declared twice: once in
 * `apps/daemon/src/features/sessions/sessions-keys.core.ts` and once as a
 * literal copy in `features/rules/rules.core.ts`, whose header comment explains
 * exactly why — importing another slice's `*.core.ts` is a cross-slice reach
 * that the axiom-debt ratchet blocks, so the copy was the only option left. A
 * `shared/` contract is importable from any pure core at zero debt, which is
 * what makes one declaration possible.
 *
 * Deliberately narrow: `POST /sessions/:id/send` still takes a raw `keys`
 * string and remains the escape hatch for anything not named here. Nothing that
 * was possible became impossible.
 */
import { Schema as S } from "effect"

export const NAMED_KEYS = [
  "escape",
  "enter",
  "tab",
  "shift-tab",
  "up",
  "down",
  "right",
  "left",
  "home",
  "end",
  "page-up",
  "page-down",
  "backspace",
  "delete",
  "space",
] as const

export type NamedKey = (typeof NAMED_KEYS)[number]

export const NamedKeySchema = S.Literal(...NAMED_KEYS)

export const isNamedKey = (value: unknown): value is NamedKey =>
  typeof value === "string" && (NAMED_KEYS as readonly string[]).includes(value)
