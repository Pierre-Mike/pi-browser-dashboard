import { useQuery } from "@tanstack/react-query"
import { api } from "../../lib/api"
import type { ScopeBundle, SkillDetail } from "./types"

// biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
const client = api as any

export const useGlobalClaudeConfig = () =>
  useQuery<ScopeBundle>({
    queryKey: ["claude-config", "global"],
    queryFn: async () => {
      const res = await client["claude-config"].global.$get()
      if (!res.ok) throw new Error(`claude-config global: HTTP ${res.status}`)
      return (await res.json()) as ScopeBundle
    },
    staleTime: 10_000,
  })

export const useProjectClaudeConfig = (projectId: string) =>
  useQuery<ScopeBundle>({
    queryKey: ["claude-config", "project", projectId],
    queryFn: async () => {
      const res = await client["claude-config"].projects[":id"].$get({ param: { id: projectId } })
      if (!res.ok) throw new Error(`claude-config project: HTTP ${res.status}`)
      return (await res.json()) as ScopeBundle
    },
    staleTime: 10_000,
  })

export const useSkillDetail = (
  scope: "global" | "project",
  projectId: string | null,
  skillId: string | null,
) =>
  useQuery<SkillDetail>({
    queryKey: ["claude-config", "skill", scope, projectId, skillId],
    enabled: skillId !== null && (scope === "global" || projectId !== null),
    queryFn: async () => {
      if (!skillId) throw new Error("missing skillId")
      const res =
        scope === "global"
          ? await client["claude-config"].global.skills[":skillId"].$get({
              param: { skillId },
            })
          : await client["claude-config"].projects[":id"].skills[":skillId"].$get({
              param: { id: projectId ?? "", skillId },
            })
      if (!res.ok) throw new Error(`skill: HTTP ${res.status}`)
      return (await res.json()) as SkillDetail
    },
    staleTime: 60_000,
  })
