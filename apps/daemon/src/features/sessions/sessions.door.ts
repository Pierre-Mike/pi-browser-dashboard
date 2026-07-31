/**
 * Published door for the `sessions` slice — the ONE file another feature slice
 * may import to reach the session registry. Every other cross-slice path into
 * `sessions` is a back-channel `bun run axiom-debt` counts as debt, and a pure
 * `*.core.ts` may not import a door at all: it re-exports a `Context.Tag`, so
 * consuming one would drag the Effect runtime into pure code (biome bans it by
 * shape).
 *
 * Narrow on purpose. `sessions.io.ts` is the slice's largest module — roster
 * watching, per-session `state.json` watchers, stat-signature bookkeeping,
 * refresh-on-read — and none of that is anyone else's business. What crosses is
 * three read methods: `snapshot`, `getOne`, `diagnostics`. A consumer that
 * needs to *change* a session goes through the routes, not through here.
 *
 * Only the Tag, not `SessionRegistryApi`: nothing outside this slice builds a
 * registry implementation, and an export with no consumer is dead code
 * `fallow audit` rejects. Publish the interface the day a sibling needs to
 * construct a stub of it.
 */
export { SessionRegistry } from "./sessions.io"
