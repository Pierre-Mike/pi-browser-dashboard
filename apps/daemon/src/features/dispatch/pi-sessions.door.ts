/**
 * Published door for the pi-sessions half of the `dispatch` slice — the ONE
 * file another feature slice may import to reach it. Every other cross-slice
 * path into `dispatch` is a back-channel that `bun run axiom-debt` counts as
 * debt, and a pure `*.core.ts` may not import a door at all: it re-exports a
 * `Context.Tag`, so consuming one would drag the Effect runtime into pure code
 * (biome bans it by shape).
 *
 * Consumers get the Tag and its interface, never `PiSessionsIoLive` and never
 * `makePiSessionsApi`. That is what makes the pi spawn log substitutable:
 * `sessions.routes` runs its whole test suite against an in-memory
 * `PiSessionsApi`, and the day pi runs are tracked by a separate process, the
 * swap is a `Layer` change at the composition root rather than an edit at four
 * `yield* PiSessionsIo` call sites.
 *
 * The data crossing here is `SessionState` — the same shape the sessions
 * registry serves, which is why both slices' routes can hand either source to
 * one explanation builder. Its declaration is not yet the `@pid/shared` Schema
 * (`pi-sessions.io.ts` still takes it from `sessions.core`); that repoint is
 * tracked as its own debt line, so this door deliberately does not re-export a
 * contract it would be lying about.
 */
export { type PiSessionsApi, PiSessionsIo } from "./pi-sessions.io"
