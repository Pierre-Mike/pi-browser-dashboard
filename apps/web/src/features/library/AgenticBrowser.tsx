import type { AgenticItem, LibraryCategory } from "./types"
import { useAgenticRepo } from "./useLibrary"

type Props = {
  category: LibraryCategory
  onRegister: (item: AgenticItem) => void
}

export const AgenticBrowser = ({ category, onRegister }: Props) => {
  const q = useAgenticRepo(category)

  if (q.isLoading) return <div className="text-sm text-slate-500">Loading agentic repo…</div>
  if (q.isError) {
    return (
      <div className="text-sm text-rose-600">
        Failed to read agentic repo: {q.error instanceof Error ? q.error.message : "unknown error"}
      </div>
    )
  }
  const listing = q.data
  if (!listing) return null

  if (listing.items.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs text-slate-500">
          Browsing{" "}
          <span className="font-mono">
            {listing.repoPath}/{category}
          </span>
        </p>
        <div className="text-sm text-slate-500 dark:text-slate-400 py-6 text-center border border-dashed border-slate-300 dark:border-slate-800 rounded-lg">
          No items under <span className="font-mono">{category}/</span> in the agentic repo.
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-slate-500">
        Browsing{" "}
        <span className="font-mono">
          {listing.repoPath}/{category}
        </span>
      </p>
      <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
        {listing.items.map((item) => (
          <li
            key={item.name}
            data-testid={`agentic-item-${category}-${item.name}`}
            className="rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2 flex flex-col gap-1"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium truncate">{item.name}</span>
              <span
                className={`text-[9px] uppercase tracking-wide rounded px-1.5 py-0.5 font-medium ${
                  item.registered
                    ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200"
                    : "bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200"
                }`}
              >
                {item.registered ? "registered" : "unregistered"}
              </span>
            </div>
            <span className="text-[10px] font-mono text-slate-500 break-all">{item.path}</span>
            {item.registered ? null : (
              <button
                type="button"
                data-testid={`agentic-register-${category}-${item.name}`}
                onClick={() => onRegister(item)}
                className="self-start text-xs rounded px-2 py-0.5 border border-sky-300 dark:border-sky-700 text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-950/30 mt-1"
              >
                Register in catalog
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
