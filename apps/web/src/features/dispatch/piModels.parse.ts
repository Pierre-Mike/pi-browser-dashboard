// `PiModelOption` + its runtime decoder for GET /dispatch/pi-models — no
// `@pid/shared` contract exists for this shape, so it is validated locally
// instead of trusted with an `as`.
import { isRecord, isString, parseArray } from "../../lib/guards"

// One row of pi's model catalog, as served by GET /dispatch/pi-models (the
// daemon shells out to `pi --list-models`, which merges pi's built-in
// provider catalog with the user's ~/.pi/agent/models.json overrides).
export type PiModelOption = {
  readonly provider: string
  readonly id: string
}

const parsePiModelOption = (v: unknown): PiModelOption | null => {
  if (!isRecord(v)) return null
  const { provider, id } = v
  return isString(provider) && isString(id) ? { provider, id } : null
}

export const parsePiModels = (v: unknown): readonly PiModelOption[] | null => {
  if (!isRecord(v)) return null
  return parseArray(v.models, parsePiModelOption)
}
