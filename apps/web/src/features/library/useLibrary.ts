import { useQuery } from "@tanstack/react-query"
import { api } from "../../lib/api"
import type { AgenticListing, CatalogBundle, LibraryCategory } from "./types"

// biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
const client = api as any

export const useCatalog = (projectId: string | null) =>
  useQuery<CatalogBundle>({
    queryKey: ["library", "catalog", projectId],
    queryFn: async () => {
      const res = await client.library.catalog.$get({
        query: projectId ? { projectId } : {},
      })
      if (!res.ok) throw new Error(`library catalog: HTTP ${res.status}`)
      return (await res.json()) as CatalogBundle
    },
    staleTime: 10_000,
  })

export const useAgenticRepo = (category: LibraryCategory | null) =>
  useQuery<AgenticListing>({
    queryKey: ["library", "agentic", category],
    enabled: category !== null,
    queryFn: async () => {
      if (!category) throw new Error("missing category")
      const res = await client.library.agentic.$get({ query: { category } })
      if (!res.ok) throw new Error(`library agentic: HTTP ${res.status}`)
      return (await res.json()) as AgenticListing
    },
    staleTime: 10_000,
  })
