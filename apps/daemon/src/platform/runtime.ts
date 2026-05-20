import { Layer, ManagedRuntime } from "effect"
import { GhIssueClientLive } from "../features/issue-driver/gh-issue.repo"
import { makeIssueDriverLive } from "../features/issue-driver/issue-driver.repo"
import { ProjectsRepoLive } from "../features/projects/projects.repo"
import { FilesRepoLive } from "../features/sessions/files.repo"
import { SessionRegistryLive } from "../features/sessions/sessions.repo"
import { ConfigRepoLive } from "./config.repo"
import { ShellRepoLive } from "./shell.repo"

const ISSUE_DRIVER_GLOBAL_CAP = 2
const ISSUE_DRIVER_PER_REPO_CAP = 1

const ProjectsLive = Layer.provide(ProjectsRepoLive, ConfigRepoLive)
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
  FilesRepoLive,
  ProjectsLive,
  IssueDriverLive,
)

export const appRuntime = ManagedRuntime.make(AppLayer)

export const shutdownRuntime = async (): Promise<void> => {
  await appRuntime.dispose()
}
