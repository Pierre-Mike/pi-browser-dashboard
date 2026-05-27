import { useMemo, useState } from "react"
import type { CatalogBundle, LibraryCategory, LibraryEntry, StatusByScope } from "./types"

type Props = {
  bundle: CatalogBundle
  category: LibraryCategory
}

export const CatalogList = ({ bundle, category }: Props) => {
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<string | null>(null)

  const entries = useMemo(() => {
    const filtered = bundle.catalog.entries.filter((e) => e.type === category)
    if (query.trim() === "") return filtered
    const q = query.trim().toLowerCase()
    return filtered.filter(
      (e) => e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q),
    )
  }, [bundle.catalog.entries, category, query])

  const selectedEntry = entries.find((e) => e.name === selected) ?? null

  if (bundle.catalog.entries.filter((e) => e.type === category).length === 0) {
    return (
      <div className="text-sm text-slate-500 dark:text-slate-400 py-6 text-center border border-dashed border-slate-300 dark:border-slate-800 rounded-lg">
        No {category} registered in the catalog.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`Search ${category}…`}
        data-testid={`library-search-${category}`}
        className="rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-2 py-1 text-xs"
      />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <ul className="md:col-span-1 flex flex-col gap-1 max-h-[60vh] overflow-auto pr-1">
          {entries.length === 0 ? (
            <li className="text-xs text-slate-500 py-2">No matches.</li>
          ) : null}
          {entries.map((entry) => {
            const status = bundle.statusByName[`${entry.type}:${entry.name}`]
            const active = selected === entry.name
            return (
              <li key={entry.name}>
                <button
                  type="button"
                  data-testid={`library-entry-${entry.type}-${entry.name}`}
                  onClick={() => setSelected(entry.name)}
                  className={`w-full text-left text-xs rounded px-2 py-1.5 border ${
                    active
                      ? "border-sky-400 bg-sky-50 dark:bg-sky-950/40 dark:border-sky-700"
                      : "border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate">{entry.name}</span>
                    <StatusChips status={status} />
                  </div>
                  {entry.description ? (
                    <div className="text-[11px] text-slate-500 line-clamp-2 mt-0.5">
                      {entry.description}
                    </div>
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>
        <div className="md:col-span-2">
          {selectedEntry === null ? (
            <div className="text-sm text-slate-500 border border-dashed border-slate-300 dark:border-slate-800 rounded-lg py-8 text-center">
              Select an entry to view details.
            </div>
          ) : (
            <EntryDetail
              entry={selectedEntry}
              status={bundle.statusByName[`${selectedEntry.type}:${selectedEntry.name}`]}
            />
          )}
        </div>
      </div>
    </div>
  )
}

const StatusChips = ({ status }: { status: StatusByScope | undefined }) => (
  <span className="flex items-center gap-1 text-[9px] uppercase tracking-wide shrink-0">
    <ScopeChip label="global" installed={status?.global === "installed"} />
    <ScopeChip label="local" installed={status?.local === "installed"} />
  </span>
)

const ScopeChip = ({ label, installed }: { label: string; installed: boolean }) => (
  <span
    className={`rounded px-1 py-0.5 ${
      installed
        ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200"
        : "bg-slate-100 dark:bg-slate-800 text-slate-500"
    }`}
  >
    {label}
    {installed ? " ✓" : ""}
  </span>
)

const sourceBadge = (source: string): { label: string; tone: string } => {
  if (source.startsWith("/") || source.startsWith("~")) {
    return {
      label: "local",
      tone: "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300",
    }
  }
  if (source.includes("github.com") || source.includes("raw.githubusercontent.com")) {
    return {
      label: "GitHub",
      tone: "bg-violet-100 dark:bg-violet-900/40 text-violet-800 dark:text-violet-200",
    }
  }
  return {
    label: "other",
    tone: "bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200",
  }
}

const EntryDetail = ({
  entry,
  status,
}: {
  entry: LibraryEntry
  status: StatusByScope | undefined
}) => {
  const badge = sourceBadge(entry.source)
  return (
    <article
      data-testid={`library-detail-${entry.type}-${entry.name}`}
      className="rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col gap-2"
    >
      <header className="flex flex-wrap items-baseline gap-2 px-3 py-2 border-b border-slate-200 dark:border-slate-800">
        <h4 className="text-sm font-semibold">{entry.name}</h4>
        <span
          className={`text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 font-medium ${badge.tone}`}
        >
          {badge.label}
        </span>
        <StatusChips status={status} />
      </header>
      <div className="px-3 pb-2 flex flex-col gap-2 text-xs">
        {entry.description ? (
          <p className="text-slate-600 dark:text-slate-400">{entry.description}</p>
        ) : null}
        <div>
          <span className="text-slate-500">source:</span>{" "}
          <span className="font-mono break-all">{entry.source}</span>
        </div>
        {entry.requires && entry.requires.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-slate-500">requires:</span>
            {entry.requires.map((r) => (
              <span
                key={r}
                className="font-mono text-[10px] rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5"
              >
                {r}
              </span>
            ))}
          </div>
        ) : null}
        <p className="text-[11px] italic text-slate-500 mt-2">
          Read-only view. Install / push / remove actions land in a follow-up.
        </p>
      </div>
    </article>
  )
}
