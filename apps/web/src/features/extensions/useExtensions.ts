import { useQuery } from "@tanstack/react-query"
import { api } from "../../lib/api"
import type { ExtensionManifest } from "./types"

// Pass a projectId to include that project's local extensions alongside the
// globals; omit it (home view) to get globals only. The id is part of the query
// key so switching projects refetches the correctly-scoped panel list.
export const useExtensions = (projectId?: string) =>
  useQuery<ExtensionManifest[]>({
    queryKey: ["extensions", projectId ?? null],
    queryFn: async () => {
      // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
      const client = api as any
      const res = await client.extensions.$get(projectId ? { query: { projectId } } : {})
      if (!res.ok) throw new Error(`extensions: HTTP ${res.status}`)
      return (await res.json()) as ExtensionManifest[]
    },
    staleTime: 30_000,
  })
