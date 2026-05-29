import { Hono } from "hono"
import { sseBus } from "../sse-bus"
import type { ExtensionManifest, ExtensionPermissions } from "./manifest"
import type { ExtensionRegistry, ExtensionScope } from "./registry"

export type WatcherFn = () => void | Promise<void>
export type EventHandler = (data: unknown) => void

export type ExtensionApiContext = {
  readonly manifest: ExtensionManifest
  readonly dir: string
  readonly registry: ExtensionRegistry
  readonly granted: ExtensionPermissions
  readonly scope?: ExtensionScope
}

export type ExtensionApi = {
  readonly registerRoute: (basePath: string, honoApp: Hono) => void
  readonly registerWatcher: (fn: WatcherFn) => void
  readonly on: (eventType: string, handler: EventHandler) => void
  readonly emit: (type: string, data: unknown) => void
  readonly watchers: readonly WatcherFn[]
}

export const createExtensionApi = (ctx: ExtensionApiContext): ExtensionApi => {
  const { manifest, dir, registry, scope = "global" } = ctx
  const watchers: WatcherFn[] = []
  // Each ext owns one Hono app; registerRoute sub-mounts under basePath. The
  // whole app is registered in the registry so mounts() exposes /ext/<name>.
  const extApp = new Hono()
  let registered = false

  const ensureRegistered = (): void => {
    registry.register({ manifest, dir, app: extApp, scope })
    registered = true
  }

  return {
    registerRoute: (basePath, honoApp) => {
      if (basePath && basePath !== "/") extApp.route(basePath, honoApp)
      else extApp.route("/", honoApp)
      if (!registered) ensureRegistered()
    },
    registerWatcher: (fn) => {
      watchers.push(fn)
    },
    on: (eventType, handler) => {
      sseBus.subscribe((e) => {
        if (e.type === eventType) handler(e.data)
      })
    },
    emit: (type, data) => {
      sseBus.publish({ type: `ext:${manifest.name}:${type}`, data })
    },
    watchers,
  }
}
