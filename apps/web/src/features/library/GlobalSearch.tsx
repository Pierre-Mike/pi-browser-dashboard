import { useMemo, useState } from "react"
import type { CatalogBundle, LibraryCategory } from "./types"

type Props = {
  bundle: CatalogBundle
  onPick: (category: LibraryCategory, name: string) => void
}

// Cross-category catalog search — the skill's `/library search <keyword>`.
// Matches name or description across every category and lets the user jump
// straight to the entry's detail in its tab.
export const GlobalSearch = ({ bundle, onPick }: Props) => {
  const [query, setQuery] = useState("")

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q === "") return []
    return bundle.catalog.entries
      .filter((e) => e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q))
      .slice(0, 50)
  }, [bundle.catalog.entries, query])

  return (
    <div className="relative">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search all categories…"
        data-testid="library-global-search"
        className="input input-bordered input-sm w-full text-xs"
      />
      {query.trim() !== "" ? (
        <div
          data-testid="library-global-results"
          className="absolute z-20 mt-1 w-full max-h-72 overflow-auto rounded-md border border-base-300 bg-base-100 shadow-lg"
        >
          {results.length === 0 ? (
            <div className="px-3 py-2 text-xs text-base-content/60">
              No matches across the catalog.
            </div>
          ) : (
            <ul className="flex flex-col">
              {results.map((entry) => {
                const status = bundle.statusByName[`${entry.type}:${entry.name}`]
                return (
                  <li key={`${entry.type}:${entry.name}`}>
                    <button
                      type="button"
                      data-testid={`library-global-result-${entry.type}-${entry.name}`}
                      onClick={() => {
                        onPick(entry.type, entry.name)
                        setQuery("")
                      }}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-base-200 flex items-center gap-2"
                    >
                      <span className="text-[9px] uppercase tracking-wide rounded bg-base-200 px-1.5 py-0.5 text-base-content/80 shrink-0">
                        {entry.type}
                      </span>
                      <span className="font-medium truncate">{entry.name}</span>
                      {status?.global === "installed" || status?.local === "installed" ? (
                        <span className="text-[9px] text-success shrink-0">installed</span>
                      ) : null}
                      <span className="text-[11px] text-base-content/60 truncate ml-auto">
                        {entry.description}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}
