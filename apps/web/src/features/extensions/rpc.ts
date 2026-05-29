// Typed postMessage RPC bridge between host and iframe extensions.
//
// The host-side dispatcher is exported as a pure function (`dispatchRpc`) so
// it can be unit-tested without a real iframe.  `mountRpcBridge` wires it
// into a window message listener for use in ExtensionHost.

import { api } from "../../lib/api"
import type { ExtensionManifest } from "./types"

// ---------- protocol types ----------

export type RpcRequest = {
  id: string
  method: string
  params?: unknown
}

export type RpcResponse = {
  id: string
  ok: boolean
  result?: unknown
  error?: string
}

// ---------- limits ----------

const MAX_MESSAGE_BYTES = 256 * 1024 // 256 KB

// ---------- method → required permission ----------

const METHOD_PERMISSION: Record<string, string> = {
  getContext: "", // always allowed
  listFiles: "fs",
  readFile: "fs",
  subscribeEvents: "events",
}

// ---------- method implementations ----------

type DispatchContext = {
  manifest: ExtensionManifest
  projectId?: string
  cwd?: string
}

const handleGetContext = (ctx: DispatchContext): unknown => ({
  projectId: ctx.projectId ?? null,
  cwd: ctx.cwd ?? null,
  extensionName: ctx.manifest.name,
})

const handleListFiles = async (params: unknown, ctx: DispatchContext): Promise<unknown> => {
  const path =
    typeof params === "object" && params !== null && "path" in params
      ? String((params as Record<string, unknown>).path)
      : "."
  // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
  const client = api as any
  const projectId = ctx.projectId
  if (!projectId) return { entries: [] }
  const res = await client.projects[projectId].files.$get({ query: { path } })
  if (!res.ok) throw new Error(`listFiles: HTTP ${res.status}`)
  return res.json()
}

const handleReadFile = async (params: unknown, ctx: DispatchContext): Promise<unknown> => {
  const path =
    typeof params === "object" && params !== null && "path" in params
      ? String((params as Record<string, unknown>).path)
      : ""
  if (!path) throw new Error("readFile: path is required")
  // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
  const client = api as any
  const projectId = ctx.projectId
  if (!projectId) throw new Error("readFile: no projectId in context")
  const res = await client.projects[projectId].files.content.$get({ query: { path } })
  if (!res.ok) throw new Error(`readFile: HTTP ${res.status}`)
  return res.json()
}

const handleSubscribeEvents = (): unknown => ({
  subscribed: true,
  note: "Events are pushed via SSE — connect to /events for the stream.",
})

// ---------- pure dispatcher ----------

export type DispatchResult =
  | { ok: true; result: unknown }
  | { ok: false; error: string; code: "bad_origin" | "oversize" | "no_permission" | "error" }

/**
 * Pure dispatcher — no DOM side effects.  Used directly in unit tests.
 *
 * @param rawData  The postMessage `event.data`
 * @param origin   The postMessage `event.origin`
 * @param expectedOrigin  The src origin of the iframe (from src URL)
 * @param manifest The extension's sanitized manifest (permissions array)
 * @param ctx      Runtime context (projectId, cwd)
 */
export const dispatchRpc = async (
  rawData: unknown,
  origin: string,
  expectedOrigin: string,
  manifest: ExtensionManifest,
  ctx: { projectId?: string; cwd?: string } = {},
): Promise<DispatchResult> => {
  // Origin check
  if (origin !== expectedOrigin) {
    return { ok: false, error: `bad origin: ${origin}`, code: "bad_origin" }
  }

  // Size cap — serialize and measure
  let serialized: string
  try {
    serialized = JSON.stringify(rawData)
  } catch {
    return { ok: false, error: "non-serializable message", code: "error" }
  }
  if (serialized.length > MAX_MESSAGE_BYTES) {
    return {
      ok: false,
      error: `message exceeds ${MAX_MESSAGE_BYTES} bytes`,
      code: "oversize",
    }
  }

  // Validate shape
  if (
    typeof rawData !== "object" ||
    rawData === null ||
    !("id" in rawData) ||
    !("method" in rawData)
  ) {
    return { ok: false, error: "invalid RPC message shape", code: "error" }
  }

  const req = rawData as RpcRequest

  // Permission gate
  const required = METHOD_PERMISSION[req.method]
  if (required === undefined) {
    return { ok: false, error: `unknown method: ${req.method}`, code: "no_permission" }
  }
  if (required !== "" && !manifest.permissions.includes(required)) {
    return {
      ok: false,
      error: `method ${req.method} requires permission '${required}'`,
      code: "no_permission",
    }
  }

  // Dispatch
  const dispCtx: DispatchContext = { manifest, ...ctx }
  try {
    let result: unknown
    switch (req.method) {
      case "getContext":
        result = handleGetContext(dispCtx)
        break
      case "listFiles":
        result = await handleListFiles(req.params, dispCtx)
        break
      case "readFile":
        result = await handleReadFile(req.params, dispCtx)
        break
      case "subscribeEvents":
        result = handleSubscribeEvents()
        break
      default:
        return { ok: false, error: `unhandled method: ${req.method}`, code: "error" }
    }
    return { ok: true, result }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      code: "error",
    }
  }
}

// ---------- DOM wiring ----------

export type RpcBridgeHandle = { destroy: () => void }

/**
 * Wires the RPC bridge to `window.addEventListener("message", ...)`.
 * Sends responses back to `iframe.contentWindow`.
 * Returns a handle with `destroy()` to clean up.
 */
export const mountRpcBridge = (
  iframeEl: HTMLIFrameElement,
  manifest: ExtensionManifest,
  ctx: { projectId?: string; cwd?: string } = {},
): RpcBridgeHandle => {
  // A sandbox without `allow-same-origin` (our default) runs the frame in an
  // opaque origin, so postMessage events arrive with origin === "null" and the
  // frame can only be targeted with "*". When same-origin IS allowed, pin to
  // the src origin. Either way `event.source === iframe.contentWindow` below is
  // the real identity boundary.
  const allowsSameOrigin = iframeEl.sandbox?.contains("allow-same-origin") ?? false
  let srcOrigin: string
  try {
    srcOrigin = new URL(iframeEl.src).origin
  } catch {
    srcOrigin = ""
  }
  const expectedOrigin = allowsSameOrigin ? srcOrigin : "null"
  const targetOrigin = allowsSameOrigin ? srcOrigin : "*"

  const handler = async (event: MessageEvent): Promise<void> => {
    // Only handle messages from this iframe — the authenticated identity gate.
    if (event.source !== iframeEl.contentWindow) return

    const result = await dispatchRpc(event.data, event.origin, expectedOrigin, manifest, ctx)

    const rawData = event.data as Record<string, unknown>
    const id = typeof rawData === "object" && rawData !== null ? (rawData.id as string) : ""

    const response: RpcResponse = result.ok
      ? { id, ok: true, result: result.result }
      : { id, ok: false, error: result.error }

    iframeEl.contentWindow?.postMessage(response, targetOrigin)
  }

  window.addEventListener("message", handler)
  return { destroy: () => window.removeEventListener("message", handler) }
}
