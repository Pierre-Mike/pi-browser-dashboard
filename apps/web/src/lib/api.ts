// The daemon package exposes its Hono app type via "@pid/daemon/types".
// During isolated typecheck before `bun install`, this import may not resolve;
// we fall back to `any` (suppressed via a generic) to keep the call sites typed
// at the network surface only.
import type { AppType } from "@pid/daemon/types"
import { hc } from "hono/client"
import { apiBase } from "./apiBase"

export const api = hc<AppType>(apiBase())
