import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { api } from "../../lib/api"
import { parseUnifiedDiff, summarizeDiff } from "./diffParse"

export type SessionFiles = {
  short: string
  changed: boolean
  files: Array<{ path: string; status: string; oldPath?: string }>
  diff: string
  truncated: boolean
  base: string | null
  worktreePath: string | null
}

export const useSessionFiles = (short: string) =>
  useQuery<SessionFiles>({
    queryKey: ["session-files", short],
    queryFn: async () => {
      // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
      const client = api as any
      const res = await client.sessions[":id"].files.$get({ param: { id: short } })
      if (!res.ok) throw new Error(`files: HTTP ${res.status}`)
      return (await res.json()) as SessionFiles
    },
    // The diff endpoint shells out to git per request — keep it cheap with a
    // short staleTime + manual refetch on session.state SSE patches.
    staleTime: 2_000,
  })

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  modified: {
    label: "M",
    cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  },
  added: {
    label: "A",
    cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  },
  deleted: { label: "D", cls: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200" },
  renamed: {
    label: "R",
    cls: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200",
  },
  copied: { label: "C", cls: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200" },
  type_changed: {
    label: "T",
    cls: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  },
  untracked: {
    label: "?",
    cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  },
  unknown: { label: "•", cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400" },
}

type Props = { short: string }

export const FilesTab = ({ short }: Props) => {
  const q = useSessionFiles(short)
  const [selected, setSelected] = useState<string | null>(null)

  const parsedFiles = useMemo(
    () => (q.data?.diff ? parseUnifiedDiff(q.data.diff) : []),
    [q.data?.diff],
  )
  const summary = useMemo(() => summarizeDiff(parsedFiles), [parsedFiles])

  const activePath = selected ?? parsedFiles[0]?.path ?? null
  const activeFile = parsedFiles.find((f) => f.path === activePath) ?? parsedFiles[0]

  if (q.isLoading) {
    return <div className="px-1 py-4 text-sm text-slate-500">Loading files…</div>
  }
  if (q.isError) {
    return (
      <div className="px-1 py-4 text-sm text-rose-600">
        Failed to load files: {q.error instanceof Error ? q.error.message : "unknown error"}
      </div>
    )
  }
  if (!q.data || !q.data.changed) {
    return (
      <div data-testid="files-empty" className="px-1 py-4 text-sm text-slate-500">
        No file changes in this session's worktree.
      </div>
    )
  }

  return (
    <div data-testid="files-tab" className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-3 px-1 py-2 text-[11px] text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
        <span>
          {q.data.files.length} file{q.data.files.length === 1 ? "" : "s"}
        </span>
        <span className="text-emerald-700 dark:text-emerald-300 font-mono">
          +{summary.additions}
        </span>
        <span className="text-rose-700 dark:text-rose-300 font-mono">-{summary.deletions}</span>
        {q.data.base ? (
          <span className="font-mono text-slate-400 dark:text-slate-500">vs {q.data.base}</span>
        ) : null}
        {q.data.truncated ? (
          <span className="ml-auto text-amber-700 dark:text-amber-300">
            diff truncated — open the worktree to see the full output
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 min-h-0">
        <ul
          data-testid="files-list"
          className="w-64 shrink-0 overflow-y-auto border-r border-slate-200 dark:border-slate-800 text-xs"
        >
          {q.data.files.map((f) => {
            const badge = STATUS_BADGE[f.status] ?? STATUS_BADGE.unknown
            const isActive = f.path === activePath
            return (
              <li key={f.path}>
                <button
                  type="button"
                  data-testid={`file-item-${f.path}`}
                  data-active={isActive ? "true" : "false"}
                  onClick={() => setSelected(f.path)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800 ${
                    isActive ? "bg-slate-100 dark:bg-slate-800" : ""
                  }`}
                  title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
                >
                  <span
                    className={`inline-flex items-center justify-center w-4 h-4 rounded text-[9px] font-bold ${badge?.cls ?? ""}`}
                  >
                    {badge?.label ?? "•"}
                  </span>
                  <span className="truncate font-mono">{f.path}</span>
                </button>
              </li>
            )
          })}
        </ul>
        <pre
          data-testid="file-diff"
          className="flex-1 min-h-0 overflow-auto text-[11px] font-mono leading-snug px-2 py-1 bg-slate-50 dark:bg-slate-950/40"
        >
          {activeFile ? (
            activeFile.lines.map((l, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: lines are positionally stable per fetch
                key={i}
                className={
                  l.kind === "addition"
                    ? "text-emerald-700 dark:text-emerald-300 bg-emerald-50/70 dark:bg-emerald-950/30"
                    : l.kind === "deletion"
                      ? "text-rose-700 dark:text-rose-300 bg-rose-50/70 dark:bg-rose-950/30"
                      : l.kind === "hunk"
                        ? "text-sky-700 dark:text-sky-300"
                        : l.kind === "header" || l.kind === "meta"
                          ? "text-slate-400 dark:text-slate-500"
                          : "text-slate-700 dark:text-slate-300"
                }
              >
                {l.text || " "}
              </div>
            ))
          ) : (
            <div className="text-slate-500">No diff content.</div>
          )}
        </pre>
      </div>
    </div>
  )
}
