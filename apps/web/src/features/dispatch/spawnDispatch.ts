import { api } from "../../lib/api"
import type { Project } from "../../lib/types"
import { normalizeEffort } from "./spawnEffort"

export type SpawnRequest = {
  readonly intent: string
  readonly project: Project | null
  readonly effort?: string
}

// POST a spawn intent to the daemon, scoping it to the project's cwd when one is
// in context and tagging the requested reasoning effort. Extracted from
// SpawnModal so the submit handler stays simple.
export const dispatchSpawn = async ({
  intent,
  project,
  effort = "",
}: SpawnRequest): Promise<void> => {
  const body: { intent: string; cwd?: string; effort?: string } = { intent }
  if (project) body.cwd = project.path
  const level = normalizeEffort(effort)
  if (level) body.effort = level
  // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
  const client = api as any
  await client.dispatch.$post({ json: body })
}
