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

// ── Filesystem mutations ────────────────────────────────────────────────────
// POST to the daemon's /:id/fs/* endpoints behind the file-tree context menu,
// inline rename, and drag-drop. Each returns a discriminated result so callers
// can reconcile the @pierre/trees model (commit the optimistic mutation) or
// surface the daemon's error reason on failure.

export type FsResult = { ok: true } | { ok: false; status: number; error: string }

const postFs = async (
  resource: FileResource,
  { op, body }: { op: "create" | "move" | "delete"; body: Record<string, unknown> },
): Promise<FsResult> => {
  let res: Response
  try {
    res = await fetch(`${resourceBase(resource)}/fs/${op}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  } catch {
    return { ok: false, status: 0, error: "network error" }
  }
  if (res.ok) return { ok: true }
  let error = `HTTP ${res.status}`
  try {
    const j = (await res.json()) as { error?: unknown }
    if (typeof j.error === "string") error = j.error
  } catch {
    // non-JSON body — keep the status-based message
  }
  return { ok: false, status: res.status, error }
}

export const fsCreate = (
  resource: FileResource,
  { path, kind }: { path: string; kind: "file" | "directory" },
): Promise<FsResult> => postFs(resource, { op: "create", body: { path, kind } })

export const fsMove = (
  resource: FileResource,
  { from, to }: { from: string; to: string },
): Promise<FsResult> => postFs(resource, { op: "move", body: { from, to } })

export const fsDelete = (
  resource: FileResource,
  { path, recursive }: { path: string; recursive: boolean },
): Promise<FsResult> => postFs(resource, { op: "delete", body: { path, recursive } })

// Legacy project-scoped URL wrappers — kept for existing call sites.
export const projectRawUrl = (projectId: string, path: string): string =>
  fileRawUrl({ kind: "projects", id: projectId }, path)

export const projectDownloadUrl = (projectId: string, path: string): string =>
  fileDownloadUrl({ kind: "projects", id: projectId }, path)
