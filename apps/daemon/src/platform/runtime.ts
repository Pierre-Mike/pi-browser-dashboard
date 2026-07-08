import { Layer, ManagedRuntime } from "effect"
import { BrainstormsRepoLive } from "../features/brainstorms/brainstorms.repo"
import { ClaudeConfigRepoLive } from "../features/claude-config/claude-config.repo"
import { PiRepoLive } from "../features/dispatch/pi.repo"
import { GlobalSettingsRepoLive } from "../features/global-settings/global-settings.repo"
import { GhIssueClientLive } from "../features/issue-driver/gh-issue.repo"
import { makeIssueDriverLive } from "../features/issue-driver/issue-driver.repo"
import { GitClientLive } from "../features/library/installer"
import { LibraryRepoLive } from "../features/library/library.repo"
import { PidAppsRepoLive } from "../features/pid-apps/pid-apps.repo"
import { PidSettingsRepoLive } from "../features/pid-settings/pid-settings.repo"
import { ProjectsRepoLive } from "../features/projects/projects.repo"
import { FilesRepoLive } from "../features/sessions/files.repo"
import { SessionRegistryLive } from "../features/sessions/sessions.repo"
import { TunnelRepoLive } from "../features/tunnel/tunnel.repo"
import { ConfigRepoLive } from "./config.repo"
import { ShellRepoLive } from "./shell.repo"

const ISSUE_DRIVER_GLOBAL_CAP = 2
const ISSUE_DRIVER_PER_REPO_CAP = 1

const ProjectsLive = Layer.provide(ProjectsRepoLive, ConfigRepoLive)
const ClaudeConfigLive = Layer.provide(
  ClaudeConfigRepoLive,
  Layer.mergeAll(ConfigRepoLive, ProjectsLive),
)
const LibraryLive = Layer.provide(
  LibraryRepoLive,
  Layer.mergeAll(ConfigRepoLive, ProjectsLive, GitClientLive),
)
const TunnelLive = Layer.provide(TunnelRepoLive, ConfigRepoLive)
const GlobalSettingsLive = Layer.provide(GlobalSettingsRepoLive, ConfigRepoLive)
const FilesLive = Layer.provide(FilesRepoLive, GlobalSettingsLive)
const PidSettingsLive = Layer.provide(PidSettingsRepoLive, ProjectsLive)
const PidAppsLive = Layer.provide(PidAppsRepoLive, ProjectsLive)
const BrainstormsLive = Layer.provide(BrainstormsRepoLive, ProjectsLive)
const IssueDriverLive = Layer.provide(
  makeIssueDriverLive({
    globalCap: ISSUE_DRIVER_GLOBAL_CAP,
    perRepoCap: ISSUE_DRIVER_PER_REPO_CAP,
  }),
  Layer.mergeAll(ProjectsLive, ShellRepoLive, GhIssueClientLive),
)

/**
 * Shared application runtime. Composes long-lived layers (the SessionRegistry
 * holds open file-watchers, so it must live for the lifetime of the process).
 */
const AppLayer = Layer.mergeAll(
  SessionRegistryLive,
  ShellRepoLive,
  PiRepoLive,
  FilesLive,
  ProjectsLive,
  ClaudeConfigLive,
  LibraryLive,
  IssueDriverLive,
  TunnelLive,
  PidSettingsLive,
  PidAppsLive,
  BrainstormsLive,
  GlobalSettingsLive,
)

export const appRuntime = ManagedRuntime.make(AppLayer)
