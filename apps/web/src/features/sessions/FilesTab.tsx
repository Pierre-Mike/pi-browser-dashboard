import { PatchDiff } from "@pierre/diffs/react"
import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"
import { api } from "../../lib/api"
import { PATCH_DIFF_OPTIONS } from "../diffs/diffsOptions"
import { parseUnifiedDiff, summarizeDiff } from "./diffParse"

type SessionFiles = {
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

type Props = { short: string }

export const FilesTab = ({ short }: Props) => {
  const q = useSessionFiles(short)

  // PatchDiff renders exactly one file (it throws on a multi-file patch), so we
  // split the unified diff per file and render one PatchDiff each. The same
  // parse feeds the tiny +/- banner.
  const parsed = useMemo(() => (q.data?.diff ? parseUnifiedDiff(q.data.diff) : []), [q.data?.diff])
  const summary = useMemo(() => summarizeDiff(parsed), [parsed])

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
  if (!q.data?.changed) {
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
      <div data-testid="file-diff" className="flex-1 min-h-0 overflow-auto px-1 py-1">
        {parsed.length > 0 ? (
          <div className="flex flex-col gap-3">
            {parsed.map((file) => (
              <PatchDiff key={file.path} patch={file.raw} options={PATCH_DIFF_OPTIONS} />
            ))}
          </div>
        ) : (
          <div className="text-slate-500 text-xs px-2 py-2">No diff content.</div>
        )}
      </div>
    </div>
  )
}
