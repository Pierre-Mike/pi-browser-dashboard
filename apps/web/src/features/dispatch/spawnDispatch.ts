import { api } from "../../lib/api"
import type { Project } from "../../lib/types"
import { normalizeEffort } from "./spawnEffort"
import { normalizeModel } from "./spawnModel"

export type SpawnRequest = {
  readonly intent: string
  readonly project: Project | null
  readonly effort?: string
  readonly model?: string
  // Explicit built-in tool allow-list, or undefined to inherit the CLI's own
  // default (every tool) — see spawnTools.ts's toolsForDispatch.
  readonly tools?: readonly string[]
}

// POST a spawn intent to the daemon, scoping it to the project's cwd when one is
// in context and tagging the requested reasoning effort. Extracted from
// SpawnModal so the submit handler stays simple.
export const dispatchSpawn = async ({
  intent,
  project,
  effort = "",
  model = "",
  tools,
}: SpawnRequest): Promise<void> => {
  const body: {
    intent: string
    cwd?: string
    effort?: string
    model?: string
    tools?: readonly string[]
  } = {
    intent,
  }
  if (project) body.cwd = project.path
  const level = normalizeEffort(effort)
  if (level) body.effort = level
  const alias = normalizeModel(model)
  if (alias) body.model = alias
  if (tools !== undefined) body.tools = tools
  // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
  const client = api as any
  await client.dispatch.$post({ json: body })
}
