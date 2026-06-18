import { api } from "../../lib/api"
import type { Project } from "../../lib/types"

// POST a spawn intent to the daemon, scoping it to the project's cwd when one is
// in context. Extracted from SpawnModal so the submit handler stays simple.
export const dispatchSpawn = async (intent: string, project: Project | null): Promise<void> => {
  const body: { intent: string; cwd?: string } = { intent }
  if (project) body.cwd = project.path
  // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
  const client = api as any
  await client.dispatch.$post({ json: body })
}
