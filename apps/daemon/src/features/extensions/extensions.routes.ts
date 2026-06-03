import { Hono } from "hono"
import { sanitizeManifest } from "../../platform/extensions/manifest"
import { extensionRegistry } from "../../platform/extensions/registry"
import type { ExtensionGrants } from "../../platform/extensions/state"
import {
  grantsFor,
  isEnabled,
  permissionKeysFromGrants,
  readState,
  setEnabled,
  setGrants,
  stateFileFor,
} from "../../platform/extensions/state"
import { sseBus } from "../../platform/sse-bus"

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

const app = new Hono()
  .post("/:name/enable", (c) => {
    const name = c.req.param("name")
    const entry = extensionRegistry.get(name)
    if (!entry) return c.json({ error: "not_found" }, 404)
    const state = setEnabled({ file: stateFileFor(entry), name, enabled: true })
    sseBus.publish({ type: "ext:state-changed", data: { name } })
    return c.json({
      name,
      enabled: isEnabled(state, name),
      grants: grantsFor(state, name),
    })
  })
  .post("/:name/disable", (c) => {
    const name = c.req.param("name")
    const entry = extensionRegistry.get(name)
    if (!entry) return c.json({ error: "not_found" }, 404)
    const state = setEnabled({ file: stateFileFor(entry), name, enabled: false })
    sseBus.publish({ type: "ext:state-changed", data: { name } })
    return c.json({
      name,
      enabled: isEnabled(state, name),
      grants: grantsFor(state, name),
    })
  })
  .post("/:name/grants", async (c) => {
    const name = c.req.param("name")
    const entry = extensionRegistry.get(name)
    if (!entry) return c.json({ error: "not_found" }, 404)
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid_body" }, 400)
    }
    if (!isRecord(body)) return c.json({ error: "invalid_body" }, 400)
    // Validate body shape — only known permission keys, correct value types.
    const { fs, exec, net, events } = body
    if (fs !== undefined && (!Array.isArray(fs) || !fs.every((v) => typeof v === "string"))) {
      return c.json({ error: "invalid_body" }, 400)
    }
    if (exec !== undefined && (!Array.isArray(exec) || !exec.every((v) => typeof v === "string"))) {
      return c.json({ error: "invalid_body" }, 400)
    }
    if (net !== undefined && (!Array.isArray(net) || !net.every((v) => typeof v === "string"))) {
      return c.json({ error: "invalid_body" }, 400)
    }
    if (events !== undefined && typeof events !== "boolean") {
      return c.json({ error: "invalid_body" }, 400)
    }
    const grants: ExtensionGrants = {}
    if (Array.isArray(fs)) grants.fs = fs as string[]
    if (Array.isArray(exec)) grants.exec = exec as string[]
    if (Array.isArray(net)) grants.net = net as string[]
    if (typeof events === "boolean") grants.events = events
    const state = setGrants({ file: stateFileFor(entry), name, grants })
    sseBus.publish({ type: "ext:state-changed", data: { name } })
    return c.json({
      name,
      enabled: isEnabled(state, name),
      grants: grantsFor(state, name),
    })
  })

export { app }

export const extensionListEntry = (
  e: ReturnType<typeof extensionRegistry.list>[number],
): Record<string, unknown> => {
  const state = readState(stateFileFor(e))
  const sanitized = sanitizeManifest(e.manifest)
  const grants = grantsFor(state, e.manifest.name)
  return {
    ...sanitized,
    scope: e.scope,
    requested: sanitized.permissions,
    granted: permissionKeysFromGrants(grants),
    enabled: isEnabled(state, e.manifest.name),
  }
}
