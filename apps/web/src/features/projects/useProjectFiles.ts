import { useQuery } from "@tanstack/react-query"
import type { FileContent, FileListing } from "../../lib/types"

// The hc client's path-param + query-string shape is awkward for these
// endpoints; bypass it and hit the configured base URL directly.
const baseUrl = (): string =>
  (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:8787"

export const useProjectDir = (projectId: string, path: string, enabled = true) =>
  useQuery<FileListing>({
    queryKey: ["project-dir", projectId, path],
    enabled,
    staleTime: 15_000,
    queryFn: async () => {
      const url = new URL(`${baseUrl()}/projects/${encodeURIComponent(projectId)}/files`)
      if (path) url.searchParams.set("path", path)
      const res = await fetch(url)
      if (!res.ok) throw new Error(`list dir: HTTP ${res.status}`)
      return (await res.json()) as FileListing
    },
  })

export const useProjectFile = (projectId: string, path: string | null) =>
  useQuery<FileContent>({
    queryKey: ["project-file", projectId, path ?? ""],
    enabled: path !== null,
    staleTime: 30_000,
    queryFn: async () => {
      if (path === null) throw new Error("no path")
      const url = new URL(`${baseUrl()}/projects/${encodeURIComponent(projectId)}/file`)
      url.searchParams.set("path", path)
      const res = await fetch(url)
      if (!res.ok) throw new Error(`read file: HTTP ${res.status}`)
      return (await res.json()) as FileContent
    },
  })
