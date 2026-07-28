// Pure decision logic for POST /:id/keys — a named vocabulary over terminal
// control bytes (escape / arrows / tab / …) so a caller can answer a
// permission prompt or an AskUserQuestion menu without hand-encoding control
// sequences into a raw `keys` string. No I/O — this module only turns an
// already-decoded JSON body into the bytes `ShellIo.send` should write.
//
// This is deliberately additive: `POST /:id/send` (raw `keys` string) is
// unchanged and remains the escape hatch for anything not named here. The
// named surface is the *safe, documented* subset — nothing that was possible
// before becomes impossible now.

import { Either } from "effect"

export type NamedKey =
  | "escape"
  | "enter"
  | "tab"
  | "shift-tab"
  | "up"
  | "down"
  | "left"
  | "right"
  | "home"
  | "end"
  | "page-up"
  | "page-down"
  | "backspace"
  | "delete"
  | "space"

export type KeyStep =
  | { readonly named: NamedKey; readonly repeat?: number }
  | { readonly text: string }

export type ResolvedKeys = {
  readonly keys: string
  readonly resolved: ReadonlyArray<string>
}

export type KeysRequestError = {
  readonly _tag: "BadSequence" | "BadStep" | "TooLong"
  readonly message: string
}

export const MAX_SEQUENCE_STEPS = 32
export const MAX_REPEAT = 32
// Same cap POST /:id/send already enforces on its raw `keys` string — the
// named path resolves to the same wire, so it inherits the same ceiling.
export const MAX_RESOLVED_KEYS_LENGTH = 4096

// The named vocabulary a caller may address by name — deliberately closed.
// Bytes follow the ANSI/xterm normal-mode cursor-key encoding, matching what
// the pooled `claude attach` (spawned with TERM=xterm-256color, see
// shell.io.ts) expects on stdin.
//
// Two control keys are deliberately absent from this vocabulary rather than
// merely undocumented — they are the terminal's own escape hatches out of the
// attach session, not app-facing keys, and naming them would let a caller
// pull a lever the daemon reserves for itself:
//   - "ctrl-z" is `sendViaPool`'s DETACH_KEY (see shell.io.ts) — the exact
//     byte the pool writes to evict an idle attach. A caller sending it would
//     detach the pooled `claude attach` behind the daemon's back, and the
//     next send would silently pay a fresh ~1.5s boot.
//   - "ctrl-c" quits the attached TUI outright. `POST /:id/stop` is the
//     supported, observable way to end a session; a ctrl-c smuggled through
//     "just another keystroke" would end it invisibly.
// Both fall through to the same "unknown name" rejection below as any other
// typo — nothing about their handling is special-cased at runtime.
const NAMED_KEY_BYTES: Record<NamedKey, string> = {
  escape: "\x1b",
  enter: "\r",
  tab: "\t",
  "shift-tab": "\x1b[Z",
  up: "\x1b[A",
  down: "\x1b[B",
  right: "\x1b[C",
  left: "\x1b[D",
  home: "\x1b[H",
  end: "\x1b[F",
  "page-up": "\x1b[5~",
  "page-down": "\x1b[6~",
  backspace: "\x7f",
  delete: "\x1b[3~",
  space: " ",
}

// Exported (not just the type) so a doc-drift guard (platform/agent-skill.ts's
// test) can assert against the real vocabulary instead of a hand-copied list.
export const NAMED_KEYS: ReadonlyArray<NamedKey> = Object.keys(
  NAMED_KEY_BYTES,
) as ReadonlyArray<NamedKey>

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

const isNamedKey = (v: unknown): v is NamedKey =>
  typeof v === "string" && Object.hasOwn(NAMED_KEY_BYTES, v)

// Matches C0 controls and DEL — a `text` step is literal input, so any
// control byte in it almost certainly means the caller meant `named` instead.
// biome-ignore lint/suspicious/noControlCharactersInRegex: this is the check for control characters
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/

const badSequence = (message: string): KeysRequestError => ({ _tag: "BadSequence", message })
const badStep = (message: string): KeysRequestError => ({ _tag: "BadStep", message })
const tooLong = (message: string): KeysRequestError => ({ _tag: "TooLong", message })

type StepResult = { readonly keys: string; readonly resolved: ReadonlyArray<string> }

const resolveNamedStep = (
  step: { readonly named: unknown; readonly repeat?: unknown },
  index: number,
): Either.Either<StepResult, KeysRequestError> => {
  if (!isNamedKey(step.named)) {
    return Either.left(
      badStep(`sequence[${index}].named is not a known key: ${JSON.stringify(step.named)}`),
    )
  }
  // Captured into its own binding — a narrowed property access doesn't
  // survive into the closure below, but a narrowed local const does.
  const named = step.named
  const repeatRaw = step.repeat
  if (
    repeatRaw !== undefined &&
    (typeof repeatRaw !== "number" ||
      !Number.isInteger(repeatRaw) ||
      repeatRaw < 1 ||
      repeatRaw > MAX_REPEAT)
  ) {
    return Either.left(
      badStep(`sequence[${index}].repeat must be an integer between 1 and ${MAX_REPEAT}`),
    )
  }
  const repeat = repeatRaw ?? 1
  return Either.right({
    keys: NAMED_KEY_BYTES[named].repeat(repeat),
    // One trail entry per repetition (["down","down","enter"], not
    // ["down×2","enter"]) — the trail reads like the keystrokes a human
    // would describe, not like a compressed encoding of them.
    resolved: Array.from({ length: repeat }, () => named),
  })
}

const resolveTextStep = (
  step: { readonly text: unknown },
  index: number,
): Either.Either<StepResult, KeysRequestError> => {
  if (typeof step.text !== "string" || step.text.length === 0) {
    return Either.left(badStep(`sequence[${index}].text must be a non-empty string`))
  }
  if (CONTROL_CHAR_RE.test(step.text)) {
    return Either.left(
      badStep(`sequence[${index}].text must not contain control characters — use "named" instead`),
    )
  }
  // Quoted/escaped so the trail stays readable without ever putting a raw
  // (even if harmless) byte string into a response body.
  return Either.right({ keys: step.text, resolved: [JSON.stringify(step.text)] })
}

const resolveStep = (raw: unknown, index: number): Either.Either<StepResult, KeysRequestError> => {
  if (!isPlainObject(raw)) {
    return Either.left(badStep(`sequence[${index}] must be an object with "named" or "text"`))
  }
  const hasNamed = "named" in raw
  const hasText = "text" in raw
  if (hasNamed === hasText) {
    return Either.left(badStep(`sequence[${index}] must have exactly one of "named" or "text"`))
  }
  return hasNamed
    ? resolveNamedStep(raw as { named: unknown; repeat?: unknown }, index)
    : resolveTextStep(raw as { text: unknown }, index)
}

// Validates an untrusted JSON body for POST /:id/keys (the `sequence` field —
// the sibling `wait` field is validated separately by `parseWaitRequest`, the
// same helper `parseWaitRequest` already validates for POST /:id/send).
export const parseKeysRequest = (raw: unknown): Either.Either<ResolvedKeys, KeysRequestError> => {
  if (!isPlainObject(raw)) return Either.left(badSequence("keys request body must be an object"))
  const { sequence } = raw
  if (!Array.isArray(sequence) || sequence.length === 0) {
    return Either.left(badSequence("sequence must be a non-empty array"))
  }
  if (sequence.length > MAX_SEQUENCE_STEPS) {
    return Either.left(badSequence(`sequence exceeds the ${MAX_SEQUENCE_STEPS}-step cap`))
  }
  let keys = ""
  const resolved: string[] = []
  for (let index = 0; index < sequence.length; index++) {
    const step = resolveStep(sequence[index], index)
    if (Either.isLeft(step)) return Either.left(step.left)
    keys += step.right.keys
    resolved.push(...step.right.resolved)
  }
  if (keys.length > MAX_RESOLVED_KEYS_LENGTH) {
    return Either.left(
      tooLong(`resolved keys length exceeds the ${MAX_RESOLVED_KEYS_LENGTH}-byte cap`),
    )
  }
  return Either.right({ keys, resolved })
}
