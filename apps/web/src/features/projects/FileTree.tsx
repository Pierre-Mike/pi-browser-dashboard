import { useState } from "react"
import type { FileEntry } from "../../lib/types"
import { formatSize, joinPath } from "./treeUtil"
import { useProjectDir, useProjectFile } from "./useProjectFiles"

type Props = {
  projectId: string
  onPick?: (path: string) => void
}

type NodeProps = {
  projectId: string
  path: string
  name: string
  depth: number
  selected: string | null
  onPick: (path: string) => void
}

const DirNode = ({ projectId, path, name, depth, selected, onPick }: NodeProps) => {
  const [open, setOpen] = useState(depth === 0)
  const q = useProjectDir(projectId, path, open)
  const indent = depth * 12
  return (
    <div>
      <button
        type="button"
        data-testid={`tree-dir-${path || "ROOT"}`}
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1 text-left text-xs py-0.5 px-1 hover:bg-slate-100 dark:hover:bg-slate-800/50 rounded"
        style={{ paddingLeft: indent + 4 }}
      >
        <span className="font-mono text-slate-400 w-3">{open ? "▾" : "▸"}</span>
        <span className="truncate">{name || "/"}</span>
      </button>
      {open ? (
        <div>
          {q.isLoading ? (
            <div className="text-[10px] text-slate-400 italic" style={{ paddingLeft: indent + 20 }}>
              loading…
            </div>
          ) : q.isError ? (
            <div className="text-[10px] text-rose-500" style={{ paddingLeft: indent + 20 }}>
              {q.error instanceof Error ? q.error.message : "failed"}
            </div>
          ) : (
            (q.data?.entries ?? []).map((e) => (
              <EntryRow
                key={e.name}
                projectId={projectId}
                parent={path}
                entry={e}
                depth={depth + 1}
                selected={selected}
                onPick={onPick}
              />
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}

const EntryRow = ({
  projectId,
  parent,
  entry,
  depth,
  selected,
  onPick,
}: {
  projectId: string
  parent: string
  entry: FileEntry
  depth: number
  selected: string | null
  onPick: (path: string) => void
}) => {
  const full = joinPath(parent, entry.name)
  if (entry.type === "dir") {
    return (
      <DirNode
        projectId={projectId}
        path={full}
        name={entry.name}
        depth={depth}
        selected={selected}
        onPick={onPick}
      />
    )
  }
  const isSelected = selected === full
  const indent = depth * 12
  return (
    <button
      type="button"
      data-testid={`tree-file-${full}`}
      onClick={() => onPick(full)}
      className={`w-full flex items-center justify-between gap-2 text-left text-xs py-0.5 px-1 rounded ${
        isSelected
          ? "bg-sky-100 dark:bg-sky-900/40 text-sky-900 dark:text-sky-100"
          : "hover:bg-slate-100 dark:hover:bg-slate-800/50"
      }`}
      style={{ paddingLeft: indent + 20 }}
    >
      <span className="truncate font-mono">{entry.name}</span>
      <span className="text-[10px] text-slate-400 shrink-0">{formatSize(entry.size)}</span>
    </button>
  )
}

const FilePreview = ({ projectId, path }: { projectId: string; path: string }) => {
  const q = useProjectFile(projectId, path)
  if (q.isLoading) return <div className="text-xs text-slate-500 p-3">Loading…</div>
  if (q.isError) {
    return (
      <div className="text-xs text-rose-500 p-3">
        {q.error instanceof Error ? q.error.message : "failed to load"}
      </div>
    )
  }
  const f = q.data
  if (!f) return null
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between text-xs px-3 py-1.5 border-b border-slate-200 dark:border-slate-800">
        <span className="font-mono truncate">{f.path}</span>
        <span className="text-slate-400 shrink-0">
          {formatSize(f.size)}
          {f.isBinary ? " · binary" : ""}
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {f.isBinary ? (
          <div className="text-xs text-slate-500 p-3">Binary file — preview omitted.</div>
        ) : (
          <pre className="text-[11px] font-mono whitespace-pre p-3 leading-snug">{f.content}</pre>
        )}
      </div>
    </div>
  )
}

export const FileTree = ({ projectId, onPick }: Props) => {
  const [selected, setSelected] = useState<string | null>(null)
  const pick = (path: string) => {
    setSelected(path)
    onPick?.(path)
  }
  return (
    <div
      data-testid="project-file-tree"
      className="grid grid-cols-1 md:grid-cols-[minmax(220px,300px)_1fr] gap-3 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden bg-white/40 dark:bg-slate-900/40"
    >
      <div className="border-r border-slate-200 dark:border-slate-800 overflow-auto max-h-[60vh] py-1">
        <DirNode
          projectId={projectId}
          path=""
          name="."
          depth={0}
          selected={selected}
          onPick={pick}
        />
      </div>
      <div className="min-h-[20vh] max-h-[60vh] overflow-hidden">
        {selected ? (
          <FilePreview projectId={projectId} path={selected} />
        ) : (
          <div className="text-xs text-slate-500 p-3">Select a file to preview.</div>
        )}
      </div>
    </div>
  )
}
