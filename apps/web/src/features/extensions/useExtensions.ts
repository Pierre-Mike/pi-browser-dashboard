import { useQuery } from "@tanstack/react-query"
import { api } from "../../lib/api"
import { parseExtensionManifests } from "./extensions.parse"
import type { ExtensionManifest } from "./types"

export const useExtensions = () =>
  useQuery<ExtensionManifest[]>({
    queryKey: ["extensions"],
    queryFn: async () => {
      // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
      const client = api as any
      const res = await client.extensions.$get()
      if (!res.ok) throw new Error(`extensions: HTTP ${res.status}`)
      const manifests = parseExtensionManifests(await res.json())
      if (!manifests) throw new Error("extensions: malformed response")
      return manifests
    },
    staleTime: 30_000,
  })
