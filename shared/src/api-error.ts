/**
 * The one error shape.
 *
 * A failure crosses HTTP as `{ error: "<machine_tag>", ... }` — a stable,
 * snake_case tag a client can branch on, plus whatever tag-specific payload
 * that failure carries (`short`, `path`, `code`, a human `message`). That is
 * the shape this daemon already emits at the great majority of its error exits
 * (`invalid_body`, `not_found`, `bad_request`, `missing_path`, …), so the
 * contract is written to describe reality rather than to propose a migration.
 *
 * `error` is a **string**, always. A handful of legacy exits pass a decoded
 * `Either` left straight through (`c.json({ error: result.left }, 400)`), which
 * puts an object where clients expect a tag; those are tracked as debt, not
 * blessed here. New code goes through `apiError` in
 * `apps/daemon/src/platform/http.ts`, which cannot produce that shape.
 *
 * The record stays open on purpose: the payload is tag-specific and is not
 * modelled per-tag. What is closed is the *type* of `error` — the one field
 * every consumer branches on.
 */
import { Schema as S } from "effect"

export const ApiErrorBody = S.Struct(
  {
    /** Machine-readable failure tag, snake_case. Branch on this. */
    error: S.String,
    /** Optional human-facing detail. Never parse this. */
    message: S.optional(S.String),
  },
  S.Record({ key: S.String, value: S.Unknown }),
)

export type ApiErrorBody = S.Schema.Type<typeof ApiErrorBody>

/**
 * Decode an error body. Excess properties are allowed here — unlike the
 * success contracts — because the tag payload is intentionally open; what is
 * asserted is that `error` is present and is a string.
 */
export const decodeApiErrorBody = S.decodeUnknownSync(ApiErrorBody)

/** Narrow an already-parsed response body to the error envelope. */
export const isApiErrorBody = S.is(ApiErrorBody)
