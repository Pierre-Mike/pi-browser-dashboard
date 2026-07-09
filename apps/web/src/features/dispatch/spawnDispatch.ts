import { api } from "../../lib/api"
import type { Project } from "../../lib/types"
import { normalizeEffort } from "./spawnEffort"
import { normalizeHarness, type SpawnHarness } from "./spawnHarness"
import { normalizeModel } from "./spawnModel"
import { normalizeThinking } from "./spawnThinking"

export type SpawnRequest = {
  readonly intent: string
  readonly project: Project | null
  // Which CLI to spawn — "claude" (default) or "pi". See spawnHarness.ts.
  readonly harness?: SpawnHarness
  readonly effort?: string
  readonly thinking?: string
  readonly model?: string
  // Explicit tool allow-list, or undefined to inherit the CLI's own default
  // (every tool) — see spawnTools.ts's toolsForDispatch.
  readonly tools?: readonly string[]
}

export type DispatchBody = {
  intent: string
  cwd?: string
  harness?: "pi"
  effort?: string
  thinking?: string
  model?: string
  tools?: readonly string[]
}

// Pure body construction, split from the POST so the harness branching is
// unit-testable. Claude keeps its historical shape byte-for-byte (no harness
// field, alias-narrowed model); pi tags the harness and speaks pi's dialect:
// `thinking` instead of `effort`, and a free-form "provider/id" model that the
// picker-fed value already constrains.
export const buildDispatchBody = ({
  intent,
  project,
  harness = "claude",
  effort = "",
  thinking = "",
  model = "",
  tools,
}: SpawnRequest): DispatchBody => {
  const body: DispatchBody = { intent }
  if (project) body.cwd = project.path
  if (normalizeHarness(harness) === "pi") {
    body.harness = "pi"
    const level = normalizeThinking(thinking)
    if (level) body.thinking = level
    if (model) body.model = model
  } else {
    const level = normalizeEffort(effort)
    if (level) body.effort = level
    const alias = normalizeModel(model)
    if (alias) body.model = alias
  }
  if (tools !== undefined) body.tools = tools
  return body
}

// Human-readable failure for a non-2xx dispatch response. The daemon forwards
// the harness's own stderr as `detail` (e.g. pi's "No API key for provider:
// …") — prefer that over a bare status code.
export const dispatchErrorMessage = (status: number, body: unknown): string => {
  const detail = (body as { detail?: unknown } | null)?.detail
  return typeof detail === "string" && detail.trim().length > 0
    ? detail
    : `dispatch: HTTP ${status}`
}

// POST a spawn intent to the daemon, scoping it to the project's cwd when one
// is in context. Extracted from SpawnModal so the submit handler stays simple.
// Returns the spawned session's short id (null when the daemon response
// carries none) so callers like the brainstorm companion panel can attach a
// terminal to the new session.
export const dispatchSpawn = async (request: SpawnRequest): Promise<string | null> => {
  // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
  const client = api as any
  const res = await client.dispatch.$post({ json: buildDispatchBody(request) })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(dispatchErrorMessage(res.status, body))
  }
  try {
    const data = (await res.json()) as { short?: unknown }
    return typeof data.short === "string" ? data.short : null
  } catch {
    return null
  }
}
