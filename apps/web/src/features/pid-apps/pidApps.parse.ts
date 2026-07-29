// Runtime decoder for `PidApp` — no `@pid/shared` contract exists for this
// shape (it is a dashboard-only view of a project's .pid/ apps), so it is
// validated locally instead of trusted with an `as`.
import { isRecord, isString, parseArray } from "../../lib/guards"
import type { PidApp } from "./pidApps"

export const parsePidApp = (v: unknown): PidApp | null => {
  if (!isRecord(v)) return null
  const { id, label, icon } = v
  if (!isString(id) || !isString(label)) return null
  if (icon !== undefined && !isString(icon)) return null
  return icon === undefined ? { id, label } : { id, label, icon }
}

export const parsePidApps = (v: unknown): PidApp[] | null => parseArray(v, parsePidApp)
