// Runtime decoder for `Brainstorm` — no `@pid/shared` contract exists for
// this shape (a dashboard-only view of a session's canvas/excalidraw boards),
// so it is validated locally instead of trusted with an `as`.
import { isRecord, isString, parseArray } from "../../lib/guards"
import type { Brainstorm, BrainstormKind } from "./brainstorms"

const BRAINSTORM_KINDS: readonly BrainstormKind[] = ["canvas", "canvasJson", "excalidraw"]

const isBrainstormKind = (v: unknown): v is BrainstormKind =>
  isString(v) && (BRAINSTORM_KINDS as readonly string[]).includes(v)

export const parseBrainstorm = (v: unknown): Brainstorm | null => {
  if (!isRecord(v)) return null
  const { path, label, kind, file, updatedAt } = v
  if (!isString(path) || !isString(label) || !isString(file) || !isString(updatedAt)) return null
  if (!isBrainstormKind(kind)) return null
  return { path, label, kind, file, updatedAt }
}

export const parseBrainstorms = (v: unknown): Brainstorm[] | null => parseArray(v, parseBrainstorm)
