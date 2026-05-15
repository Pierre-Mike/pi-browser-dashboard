import { Layer, ManagedRuntime } from "effect"
import { ProjectsRepoLive } from "../features/projects/projects.repo"
import { SessionRegistryLive } from "../features/sessions/sessions.repo"
import { ConfigRepoLive } from "./config.repo"
import { ShellRepoLive } from "./shell.repo"

/**
 * Shared application runtime. Composes long-lived layers (the SessionRegistry
 * holds open file-watchers, so it must live for the lifetime of the process).
 */
const AppLayer = Layer.mergeAll(
  SessionRegistryLive,
  ShellRepoLive,
  Layer.provide(ProjectsRepoLive, ConfigRepoLive),
)

export const appRuntime = ManagedRuntime.make(AppLayer)

export const shutdownRuntime = async (): Promise<void> => {
  await appRuntime.dispose()
}
