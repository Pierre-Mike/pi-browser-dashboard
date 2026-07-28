import { Context, Effect, Layer } from "effect"
import { ConfigService } from "../../platform/config.io"
import type { TunnelState } from "./tunnel.core"
import { getTunnelState, startTunnel, stopTunnel } from "./tunnel-process.io"

export type TunnelServiceApi = {
  readonly getState: () => Effect.Effect<TunnelState>
  readonly start: () => Effect.Effect<TunnelState>
  readonly stop: () => Effect.Effect<TunnelState>
}

export class TunnelService extends Context.Tag("TunnelService")<
  TunnelService,
  TunnelServiceApi
>() {}

/**
 * Effect wrapper over the imperative tunnel.process manager. The target port
 * is read once at layer construction (cloudflared exposes it publicly).
 */
export const TunnelIoLive: Layer.Layer<TunnelService, never, ConfigService> = Layer.effect(
  TunnelService,
  Effect.gen(function* () {
    const config = yield* Effect.flatMap(ConfigService, (s) => s.get())
    return {
      getState: () => Effect.sync(() => getTunnelState()),
      start: () => Effect.promise(() => startTunnel(config.tunnelPort)),
      stop: () => Effect.promise(() => stopTunnel()),
    }
  }),
)
