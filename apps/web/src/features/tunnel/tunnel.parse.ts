// `TunnelState` + its runtime decoder — no `@pid/shared` contract exists for
// this shape, so it is validated locally instead of trusted with an `as`.
// The type lives here (not in useTunnel.ts) because the decoder is the thing
// that actually defines what a valid `TunnelState` is on the wire.
import { isRecord, isString } from "../../lib/guards"

export type TunnelStatus = "stopped" | "starting" | "running" | "error"

export type TunnelState = {
  readonly status: TunnelStatus
  readonly url: string | null
  readonly error?: string
}

const isTunnelStatus = (v: unknown): v is TunnelStatus =>
  v === "stopped" || v === "starting" || v === "running" || v === "error"

export const parseTunnelState = (v: unknown): TunnelState | null => {
  if (!isRecord(v)) return null
  const { status, url, error } = v
  if (!isTunnelStatus(status)) return null
  if (url !== null && !isString(url)) return null
  if (error !== undefined && !isString(error)) return null
  return error === undefined ? { status, url } : { status, url, error }
}
