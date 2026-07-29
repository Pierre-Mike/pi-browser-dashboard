import { useQuery } from "@tanstack/react-query"
import { api } from "../../lib/api"
import { parseScopeBundle, parseSkillDetail } from "./claudeConfig.parse"

// biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
const client = api as any

export const useGlobalClaudeConfig = () =>
  useQuery({
    queryKey: ["claude-config", "global"],
    queryFn: async () => {
      const res = await client["claude-config"].global.$get()
      if (!res.ok) throw new Error(`claude-config global: HTTP ${res.status}`)
      const bundle = parseScopeBundle(await res.json())
      if (!bundle) throw new Error("claude-config global: malformed response")
      return bundle
    },
    staleTime: 10_000,
  })

export const useProjectClaudeConfig = (projectId: string) =>
  useQuery({
    queryKey: ["claude-config", "project", projectId],
    enabled: projectId !== "",
    queryFn: async () => {
      const res = await client["claude-config"].projects[":id"].$get({ param: { id: projectId } })
      if (!res.ok) throw new Error(`claude-config project: HTTP ${res.status}`)
      const bundle = parseScopeBundle(await res.json())
      if (!bundle) throw new Error("claude-config project: malformed response")
      return bundle
    },
    staleTime: 10_000,
  })

export const useSkillDetail = ({
  scope,
  projectId,
  skillId,
}: {
  scope: "global" | "project"
  projectId: string | null
  skillId: string | null
}) =>
  useQuery({
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
      const detail = parseSkillDetail(await res.json())
      if (!detail) throw new Error("skill: malformed response")
      return detail
    },
    staleTime: 60_000,
  })
