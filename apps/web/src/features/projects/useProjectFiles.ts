import { useQuery } from "@tanstack/react-query"
import { apiBase as baseUrl } from "../../lib/apiBase"
import type { FileContent } from "../../lib/types"

// The hc client's path-param + query-string shape is awkward for these
// endpoints; bypass it and hit the configured base URL directly.

type ProjectTree = {
  readonly paths: readonly string[]
  readonly truncated: boolean
}

// Full flat path list for the project, fed to @pierre/trees (which builds and
// virtualises the tree). Cached longer than a single dir listing — the whole
// tree is one request and rarely changes mid-view.
export const useProjectTree = (projectId: string) =>
  useQuery<ProjectTree>({
    queryKey: ["project-tree", projectId],
    staleTime: 15_000,
    queryFn: async () => {
      const url = new URL(`${baseUrl()}/projects/${encodeURIComponent(projectId)}/tree`)
      const res = await fetch(url)
      if (!res.ok) throw new Error(`list tree: HTTP ${res.status}`)
      return (await res.json()) as ProjectTree
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

// Stable URL the browser can fetch directly for an image/audio/video/pdf/html
// element's `src` (or for an "Open raw" link). The daemon streams the file with
// the correct Content-Type so the browser renders it natively.
export const projectRawUrl = (projectId: string, path: string): string => {
  const url = new URL(`${baseUrl()}/projects/${encodeURIComponent(projectId)}/raw`)
  url.searchParams.set("path", path)
  return url.toString()
}

// Same endpoint as `projectRawUrl`, but with `download=1` so the daemon sends a
// `Content-Disposition: attachment` header. That forces a download of the file
// under its original name — which the `<a download>` attribute alone cannot
// guarantee cross-origin (daemon on :8787, web on its own port).
export const projectDownloadUrl = (projectId: string, path: string): string => {
  const url = new URL(`${baseUrl()}/projects/${encodeURIComponent(projectId)}/raw`)
  url.searchParams.set("path", path)
  url.searchParams.set("download", "1")
  return url.toString()
}
