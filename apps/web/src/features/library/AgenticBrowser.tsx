import type { AgenticItem, LibraryCategory } from "./types"
import { useAgenticRepo } from "./useLibrary"

type Props = {
  category: LibraryCategory
  onRegister: (item: AgenticItem) => void
}

export const AgenticBrowser = ({ category, onRegister }: Props) => {
  const q = useAgenticRepo(category)

  if (q.isLoading) return <div className="text-sm text-base-content/60">Loading agentic repo…</div>
  if (q.isError) {
    return (
      <div className="text-sm text-error">
        Failed to read agentic repo: {q.error instanceof Error ? q.error.message : "unknown error"}
      </div>
    )
  }
  const listing = q.data
  if (!listing) return null

  if (listing.items.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs text-base-content/60">
          Browsing{" "}
          <span className="font-mono">
            {listing.repoPath}/{category}
          </span>
        </p>
        <div className="text-sm text-base-content/60 py-6 text-center border border-dashed border-base-300 rounded-lg">
          No items under <span className="font-mono">{category}/</span> in the agentic repo.
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-2">
      <p className="text-xs text-base-content/60">
        Browsing{" "}
        <span className="font-mono">
          {listing.repoPath}/{category}
        </span>
      </p>
      <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 flex-1 min-h-0 overflow-auto content-start">
        {listing.items.map((item) => (
          <li
            key={item.name}
            data-testid={`agentic-item-${category}-${item.name}`}
            className="rounded border border-base-300 bg-base-100 p-2 flex flex-col gap-1"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium truncate">{item.name}</span>
              <span
                className={`text-[9px] uppercase tracking-wide rounded px-1.5 py-0.5 font-medium ${
                  item.registered ? "bg-success/15 text-success" : "bg-warning/15 text-warning"
                }`}
              >
                {item.registered ? "registered" : "unregistered"}
              </span>
            </div>
            <span className="text-[10px] font-mono text-base-content/60 break-all">
              {item.path}
            </span>
            {item.registered ? null : (
              <button
                type="button"
                data-testid={`agentic-register-${category}-${item.name}`}
                onClick={() => onRegister(item)}
                className="self-start text-xs rounded px-2 py-0.5 border border-primary/40 text-primary hover:bg-primary/10 mt-1"
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
