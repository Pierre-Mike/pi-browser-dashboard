// Runtime decoder for `PidSettings` — no `@pid/shared` contract exists for
// this shape, so it is validated locally instead of trusted with an `as`.
import { isRecord, isStringArray } from "../../lib/guards"
import type { PidSettings } from "./types"

export const parsePidSettings = (v: unknown): PidSettings | null => {
  if (!isRecord(v)) return null
  const { defaultSkills } = v
  return isStringArray(defaultSkills) ? { defaultSkills } : null
}
