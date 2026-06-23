import type { GitStatusEntry } from "@pierre/trees"
import { useQuery } from "@tanstack/react-query"
import { apiBase as baseUrl } from "../../lib/apiBase"
import type { FileContent } from "../../lib/types"

// The hc client's path-param + query-string shape is awkward for these
// endpoints; bypass it and hit the configured base URL directly.

export type FileResource = { kind: "projects" | "sessions"; id: string }

type ProjectTree = {
  readonly paths: readonly string[]
  readonly truncated: boolean
  // Present when requested with `?gitStatus=1`; drives @pierre/trees row badges.
  readonly gitStatus?: readonly GitStatusEntry[]
}

const resourceBase = (resource: FileResource): string =>
  `${baseUrl()}/${resource.kind}/${encodeURIComponent(resource.id)}`

// Full flat path list, fed to @pierre/trees. `?gitStatus=1` rides the same
// request so dirty-file badges land together with the listing.
export const useFileResource = (resource: FileResource) =>
  useQuery<ProjectTree>({
    queryKey: ["file-tree", resource.kind, resource.id],
    staleTime: 15_000,
    queryFn: async () => {
      const url = new URL(`${resourceBase(resource)}/tree`)
      url.searchParams.set("gitStatus", "1")
      const res = await fetch(url)
      if (!res.ok) throw new Error(`list tree: HTTP ${res.status}`)
      return (await res.json()) as ProjectTree
    },
  })

export const useFileContent = (resource: FileResource, path: string | null) =>
  useQuery<FileContent>({
    queryKey: ["file-content", resource.kind, resource.id, path ?? ""],
    enabled: path !== null,
    staleTime: 30_000,
    queryFn: async () => {
      if (path === null) throw new Error("no path")
      const url = new URL(`${resourceBase(resource)}/file`)
      url.searchParams.set("path", path)
      const res = await fetch(url)
      if (!res.ok) throw new Error(`read file: HTTP ${res.status}`)
      return (await res.json()) as FileContent
    },
  })

// Stable URL the browser can fetch directly for an image/audio/video/pdf/html
// element's `src` (or for an "Open raw" link). The daemon streams the file with
// the correct Content-Type so the browser renders it natively.
export const fileRawUrl = (resource: FileResource, path: string): string => {
  const url = new URL(`${resourceBase(resource)}/raw`)
  url.searchParams.set("path", path)
  return url.toString()
}

// Same endpoint as `fileRawUrl`, but with `download=1` so the daemon sends a
// `Content-Disposition: attachment` header. That forces a download of the file
// under its original name — which the `<a download>` attribute alone cannot
// guarantee cross-origin (daemon on :8787, web on its own port).
export const fileDownloadUrl = (resource: FileResource, path: string): string => {
  const url = new URL(`${resourceBase(resource)}/raw`)
  url.searchParams.set("path", path)
  url.searchParams.set("download", "1")
  return url.toString()
}

// Legacy project-scoped URL wrappers — kept for existing call sites.
export const projectRawUrl = (projectId: string, path: string): string =>
  fileRawUrl({ kind: "projects", id: projectId }, path)

export const projectDownloadUrl = (projectId: string, path: string): string =>
  fileDownloadUrl({ kind: "projects", id: projectId }, path)
