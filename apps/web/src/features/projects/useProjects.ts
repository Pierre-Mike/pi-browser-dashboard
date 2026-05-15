import { useQuery } from "@tanstack/react-query"
import { api } from "../../lib/api"
import type { Project } from "../../lib/types"

export const useProjects = () =>
  useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: async () => {
      // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
      const client = api as any
      const res = await client.projects.$get()
      if (!res.ok) throw new Error(`projects: HTTP ${res.status}`)
      return (await res.json()) as Project[]
    },
    staleTime: 30_000,
  })
