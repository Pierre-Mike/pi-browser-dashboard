/**
 * Published door for the `projects` slice — the ONE file another feature slice
 * may import to reach it. Every other cross-slice path into `projects` is a
 * back-channel `bun run axiom-debt` counts as debt, and a pure `*.core.ts` may
 * not import a door at all: it re-exports a `Context.Tag`, so consuming one
 * would drag the Effect runtime into pure code (biome bans it by shape).
 *
 * This slice is the most reached-into in the daemon — six sibling slices need to
 * turn a project id into a path — and the reaches were four different couplings
 * wearing one import specifier. Each is answered differently on purpose:
 *
 * - **`ProjectsService`** — the Tag. What most consumers actually want.
 * - **`resolveProjectDir`** — a total derivation over the Tag's own interface:
 *   reject an unsafe id (`"forbidden"`), fail an unknown one (`"not_found"`),
 *   else hand back the path. Published rather than turned into a method on the
 *   API because a method would have to be implemented by *every* Layer,
 *   including the test one — and "id -> path resolution lives in exactly one
 *   place" is the reason this function exists at all. A second implementation
 *   in a test Layer is precisely the drift it was written to prevent.
 * - **`ProjectsIoTest`** — the in-memory Layer. First-class on purpose: the
 *   scaffolder's io template ships an `IoTest` next to the live Layer so a
 *   *consumer's* route test can run the real handlers over fixture projects.
 *   A test Layer is a published capability, not an internal detail.
 * - **`Project`** — the wire contract, re-exported straight from `@pid/shared`
 *   so a consumer that needs both the Tag and the shape has one import site.
 *
 * What is deliberately NOT here: **`ProjectsIoLive`**. Choosing the live
 * implementation is the composition root's job, and a consumer that names it is
 * pinning the Tag to one Layer — the coupling the door exists to prevent. Three
 * sibling *tests* still import it directly (`claude-config`, `library`,
 * `pid-settings`) because each composes the real projects Layer over a test
 * `ConfigService` pointed at a temp root, which is a composition root's job done
 * inside a test. Those stay recorded as debt rather than being waved through
 * here; publishing the live Layer to make three numbers smaller would sell the
 * whole point of the door.
 *
 * `ProjectsServiceApi` and `ProjectResolveError` are also unpublished: no
 * consumer names either (`resolveProjectDir` takes the API and its failures are
 * piped, never annotated), and an export with no consumer is dead code
 * `fallow audit` rejects. Publish them when something imports them.
 */
export type { Project } from "@pid/shared"
export { ProjectsIoTest, ProjectsService, resolveProjectDir } from "./projects.io"
