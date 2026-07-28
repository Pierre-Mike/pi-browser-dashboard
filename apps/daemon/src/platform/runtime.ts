import { Layer, ManagedRuntime } from "effect"
import { ClaudeConfigIoLive } from "../features/claude-config/claude-config.io"
import { PiIoLive } from "../features/dispatch/pi.io"
import { PiSessionsIoLive } from "../features/dispatch/pi-sessions.io"
import { GlobalSettingsIoLive } from "../features/global-settings/global-settings.io"
import { GhIssueClientLive } from "../features/issue-driver/gh-issue.io"
import { makeIssueDriverLive } from "../features/issue-driver/issue-driver.io"
import { GitClientLive } from "../features/library/installer.io"
import { LibraryIoLive } from "../features/library/library.io"
import { PidAppsIoLive } from "../features/pid-apps/pid-apps.io"
import { PidSettingsIoLive } from "../features/pid-settings/pid-settings.io"
import { ProjectsIoLive } from "../features/projects/projects.io"
import { FilesIoLive } from "../features/sessions/files.io"
import { SessionRegistryLive } from "../features/sessions/sessions.io"
import { SessionWaitIoLive } from "../features/sessions/sessions-wait.io"
import { TunnelIoLive } from "../features/tunnel/tunnel.io"
import { ConfigIoLive } from "./config.io"
import { ShellIoLive } from "./shell.io"

const ISSUE_DRIVER_GLOBAL_CAP = 2
const ISSUE_DRIVER_PER_REPO_CAP = 1

const ProjectsLive = Layer.provide(ProjectsIoLive, ConfigIoLive)
const ClaudeConfigLive = Layer.provide(
  ClaudeConfigIoLive,
  Layer.mergeAll(ConfigIoLive, ProjectsLive),
)
const LibraryLive = Layer.provide(
  LibraryIoLive,
  Layer.mergeAll(ConfigIoLive, ProjectsLive, GitClientLive),
)
const TunnelLive = Layer.provide(TunnelIoLive, ConfigIoLive)
const GlobalSettingsLive = Layer.provide(GlobalSettingsIoLive, ConfigIoLive)
const FilesLive = Layer.provide(FilesIoLive, GlobalSettingsLive)
const PidSettingsLive = Layer.provide(PidSettingsIoLive, ProjectsLive)
const PidAppsLive = Layer.provide(PidAppsIoLive, ProjectsLive)
const SessionWaitLive = Layer.provide(SessionWaitIoLive, SessionRegistryLive)
const IssueDriverLive = Layer.provide(
  makeIssueDriverLive({
    globalCap: ISSUE_DRIVER_GLOBAL_CAP,
    perRepoCap: ISSUE_DRIVER_PER_REPO_CAP,
  }),
  Layer.mergeAll(ProjectsLive, ShellIoLive, GhIssueClientLive),
)

/**
 * Shared application runtime. Composes long-lived layers (the SessionRegistry
 * holds open file-watchers, so it must live for the lifetime of the process).
 */
const AppLayer = Layer.mergeAll(
  SessionRegistryLive,
  SessionWaitLive,
  ShellIoLive,
  // PiIo (spawn) and PiSessionsIo (visibility) share the spawn log:
  // dispatch records into it, the sessions routes list from it.
  Layer.provide(PiIoLive, PiSessionsIoLive),
  PiSessionsIoLive,
  FilesLive,
  ProjectsLive,
  ClaudeConfigLive,
  LibraryLive,
  IssueDriverLive,
  TunnelLive,
  PidSettingsLive,
  PidAppsLive,
  GlobalSettingsLive,
)

export const appRuntime = ManagedRuntime.make(AppLayer)
