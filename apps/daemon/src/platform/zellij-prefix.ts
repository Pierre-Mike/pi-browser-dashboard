// The zellij session-name prefix, resolved once through the config funnel.
//
// Lives in platform/ rather than inside the terminal slice for two reasons.
// First, the environment is read in exactly one place (`config.io.ts`) and
// slices receive values — so the slice needs a value, not a config dependency.
// Second, `platform/*.io.ts` modules are the shape the axiom-debt scanner
// counts as a cross-slice reach when a slice imports them; the suffix-less
// platform helpers (`sse-bus`, `ws`, `runtime`) are the established way a
// slice consumes shared infra, so this follows them.
//
// Resolved synchronously: `ConfigService.get()` is a pure `Effect.succeed`
// under the hood with no async acquisition, and the five terminal WS handlers
// are constructed at module load, before any request can arrive.
import { Effect } from "effect"
import { ConfigIoLive, ConfigService } from "./config.io"

export const readZellijPrefix = (): string =>
  Effect.runSync(
    Effect.provide(
      Effect.flatMap(ConfigService, (s) => s.get()),
      ConfigIoLive,
    ),
  ).zellijPrefix
