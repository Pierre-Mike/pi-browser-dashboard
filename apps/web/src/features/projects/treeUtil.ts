import type { FileEntry } from "../../lib/types"

export const joinPath = (parent: string, name: string): string =>
  parent === "" ? name : `${parent}/${name}`

export const parentOf = (path: string): string => {
  const i = path.lastIndexOf("/")
  return i < 0 ? "" : path.slice(0, i)
}

// Human-readable size; matches what a casual reader expects. Used only in the
// tree UI, so locale-naive units (1024 base) are fine.
export const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
