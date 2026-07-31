/**
 * Published door for the `global-settings` slice — the ONE file another feature
 * slice may import to read or update the machine-wide settings document. Every
 * other cross-slice path into this slice is a back-channel `bun run axiom-debt`
 * counts as debt, and a pure `*.core.ts` may not import a door at all: it
 * re-exports a `Context.Tag`, so consuming one would drag the Effect runtime
 * into pure code (biome bans it by shape).
 *
 * A consumer asks the service for the *values*; it never imports the slice's
 * **defaults**. `DEFAULT_GLOBAL_SETTINGS` is deliberately not published: it is
 * this slice's policy (see the slice's CLAUDE.md), and a sibling that compiled
 * a default in would keep serving that default after the user changed the
 * setting — a stale read that type-checks. Read your section in the
 * `Layer.effect` build instead, the way `FilesIoLive` does.
 *
 * `gitBaseCandidates` is published because it is a **derivation** of a section,
 * not a default: pure, total, and keyed only on the shared `GitSettings` shape,
 * so the ordering policy for diff base refs stays owned here rather than being
 * re-guessed by every consumer that wants to diff a worktree. Publishing it as
 * a function of the section (rather than as a method on the service) keeps it
 * usable wherever the settings already are in hand.
 *
 * The data crossing the door is `GlobalSettings` / `GlobalSettingsPatch` /
 * `GitSettings`, effect `Schema`s in `@pid/shared` because `apps/web` edits the
 * same document. Import those from `@pid/shared` directly — that is already one
 * shared declaration, so re-exporting them here would only add a second import
 * site for the same contract, plus an unused export for `fallow audit` to call
 * dead. The service *interface* type is unpublished for the same reason: no
 * consumer builds a `GlobalSettingsService` implementation, and this slice ships
 * `GlobalSettingsIoTest` for the ones that need a stub. Publish it the day
 * someone imports it.
 */
export { gitBaseCandidates } from "./global-settings.core"
export { GlobalSettingsService } from "./global-settings.io"
