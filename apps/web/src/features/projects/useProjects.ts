import { decodeProjectArray, type Project } from "@pid/shared"
import { useQuery } from "@tanstack/react-query"
import { api } from "../../lib/api"

export const useProjects = () =>
  useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: async () => {
      // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
      const client = api as any
      const res = await client.projects.$get()
      if (!res.ok) throw new Error(`projects: HTTP ${res.status}`)
      // Copied into a mutable array: the decoder's `readonly` element type
      // would otherwise narrow `useQuery`'s inferred data type for every
      // consumer of this hook.
      return [...decodeProjectArray(await res.json())]
    },
    staleTime: 30_000,
  })
