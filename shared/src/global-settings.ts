/**
 * The `GlobalSettings` contract — the dashboard's machine-wide settings file
 * (`<claudeConfigDir>/pid-dashboard/settings.json`) as it crosses
 * `GET`/`POST /settings`.
 *
 * This was previously declared twice: once in
 * `apps/daemon/src/features/global-settings/global-settings.core.ts` and once by
 * hand in `apps/web/src/features/global-settings/types.ts`, under a comment
 * reading "Mirrors apps/daemon/…/global-settings.core.ts". Same shape of defect
 * as the `SessionState` and `Project` mirrors this workspace was created to
 * delete, and already drifting in kind: the web copy re-spelled each nested
 * section inline rather than naming it, so a section could gain a field on the
 * daemon side with nothing left to disagree with it.
 *
 * The *defaults* deliberately stay in the daemon core. A default is a policy the
 * file's owner picks (`~/Github`, port 8787), not a shape both ends must agree
 * on — and the web app never needs one, because it renders whatever the daemon
 * resolved. What is shared is the shape; what is local is the opinion.
 */
import { Schema as S } from "effect"

export const GitSettings = S.Struct({
  /** Branch PRs target and worktrees branch from. */
  defaultBranch: S.String,
  /** Remote name used for fetch/push/PR base. */
  remoteName: S.String,
})
export type GitSettings = S.Schema.Type<typeof GitSettings>

export const LibrarySettings = S.Struct({
  /** Path to the library catalog YAML. */
  catalogPath: S.String,
  /** Path to the `agentic` checkout backing `library install`. */
  agenticRepoPath: S.String,
})
export type LibrarySettings = S.Schema.Type<typeof LibrarySettings>

export const OrchestrationSettings = S.Struct({
  /** Binary used to spawn sessions (`claude --bg …`). */
  claudeBin: S.String,
  /** Agent pre-filled in the dispatch bar (empty = none). */
  defaultAgent: S.String,
  /** Permission mode pre-filled in the dispatch bar (empty = none). */
  defaultPermissionMode: S.String,
  /** Reasoning effort pre-filled in the dispatch bar (empty = none). */
  defaultEffort: S.String,
  /** Max sessions a single dispatch may fan out to. */
  maxParallel: S.Number,
})
export type OrchestrationSettings = S.Schema.Type<typeof OrchestrationSettings>

export const NetworkSettings = S.Struct({
  /** Root under which projects are discovered. */
  projectsRoot: S.String,
  /** Port the daemon listens on. */
  appPort: S.Number,
  /** Local port the Cloudflare quick-tunnel exposes publicly. */
  tunnelPort: S.Number,
})
export type NetworkSettings = S.Schema.Type<typeof NetworkSettings>

/**
 * A named, reusable set of skills (slash-commands) the spawn modal applies in
 * one click. Stored globally so the same preset is offered in every project.
 */
export const SkillGroup = S.Struct({
  /** Display name, also the dedupe key. */
  name: S.String,
  /** Skill ids selected when this group is applied, in selection order. */
  skills: S.Array(S.String),
})
export type SkillGroup = S.Schema.Type<typeof SkillGroup>

export const GlobalSettings = S.Struct({
  git: GitSettings,
  library: LibrarySettings,
  orchestration: OrchestrationSettings,
  network: NetworkSettings,
  /**
   * A list, not a section: a patch that includes it replaces the whole set, and
   * omitting it leaves the stored groups untouched.
   */
  skillGroups: S.Array(SkillGroup),
})
export type GlobalSettings = S.Schema.Type<typeof GlobalSettings>

/**
 * Decode an untrusted settings body (an RPC response, a fixture).
 *
 * `onExcessProperty: "error"` on purpose, and it reaches the nested sections
 * too: an undocumented field means the daemon and this contract have diverged,
 * and failing at the boundary beats an `undefined` surfacing inside a form three
 * components deep. Strict is safe because the daemon and the web bundle ship as
 * one artifact (`apps/cli/dist-web`) — they are never at different versions.
 */
export const decodeGlobalSettings = S.decodeUnknownSync(GlobalSettings, {
  onExcessProperty: "error",
})

/**
 * A partial update. Every section is optional and every field within a section
 * is optional: the daemon merges field-by-field and drops values that fail
 * validation, so a bad request can never corrupt stored state.
 *
 * Not a `Schema`: nothing decodes a patch against this type. The daemon
 * re-validates each field with the same readers `parse` uses (a `Schema` would
 * reject the whole body where the daemon wants to keep the good fields), and the
 * web app only ever *builds* one. It lives here anyway so the two ends cannot
 * hold different opinions about which sections are patchable.
 */
export type GlobalSettingsPatch = {
  readonly git?: Partial<GitSettings>
  readonly library?: Partial<LibrarySettings>
  readonly orchestration?: Partial<OrchestrationSettings>
  readonly network?: Partial<NetworkSettings>
  readonly skillGroups?: readonly SkillGroup[]
}
