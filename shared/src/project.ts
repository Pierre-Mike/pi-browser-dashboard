/**
 * The `Project` contract — a git checkout the dashboard knows about.
 *
 * Also previously declared twice (`apps/daemon/src/features/projects/
 * projects.io.ts` and the hand-written mirror in `apps/web/src/lib/types.ts`),
 * also already drifted: the mirror never gained `lastCommitMs`.
 *
 * Declaring it in `shared/` has a second effect beyond de-duplication: the
 * daemon's copy lived in a `*.io.ts` file, which the core-purity rules forbid a
 * `*.core.ts` from importing. A contract in `shared/` is importable from a pure
 * core, so slice logic can be typed against a project without reaching into
 * another slice's imperative shell.
 */
import { Schema as S } from "effect"

export const Project = S.Struct({
  id: S.String,
  name: S.String,
  path: S.String,
  isGitRepo: S.Boolean,
  lastModified: S.Number,
  /** Epoch ms of HEAD's commit; absent when the checkout has no commits. */
  lastCommitMs: S.optional(S.Number),
  branch: S.optional(S.String),
  githubUrl: S.optional(S.String),
  githubOwner: S.optional(S.String),
  githubRepo: S.optional(S.String),
})

export type Project = S.Schema.Type<typeof Project>

export const decodeProject = S.decodeUnknownSync(Project, { onExcessProperty: "error" })

export const ProjectArray = S.Array(Project)

export const decodeProjectArray = S.decodeUnknownSync(ProjectArray, {
  onExcessProperty: "error",
})
