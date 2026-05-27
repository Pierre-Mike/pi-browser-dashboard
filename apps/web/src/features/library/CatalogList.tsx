import { useMemo, useState } from "react"
import { InstallDialog } from "./dialogs/InstallDialog"
import { RemoveDialog } from "./dialogs/RemoveDialog"
import type {
  CatalogBundle,
  InstallScope,
  LibraryCategory,
  LibraryEntry,
  StatusByScope,
} from "./types"
import { usePushMutation } from "./useLibrary"

type Props = {
  bundle: CatalogBundle
  category: LibraryCategory
  projectId: string | null
}

type DialogState =
  | { kind: "none" }
  | { kind: "install"; entry: LibraryEntry; scope?: InstallScope }
  | { kind: "remove"; entry: LibraryEntry }

export const CatalogList = ({ bundle, category, projectId }: Props) => {
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<string | null>(null)
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" })
  const pushM = usePushMutation()

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
              projectId={projectId}
              pushPending={pushM.isPending}
              pushError={pushM.error instanceof Error ? pushM.error.message : null}
              onInstall={(scope) =>
                setDialog({ kind: "install", entry: selectedEntry, ...(scope ? { scope } : {}) })
              }
              onRemove={() => setDialog({ kind: "remove", entry: selectedEntry })}
              onPush={(scope) =>
                pushM.mutate({
                  name: selectedEntry.name,
                  type: selectedEntry.type,
                  scope,
                  ...(scope === "local" && projectId ? { projectId } : {}),
                })
              }
            />
          )}
        </div>
      </div>
      <InstallDialog
        open={dialog.kind === "install"}
        entry={dialog.kind === "install" ? dialog.entry : null}
        projectId={projectId}
        {...(dialog.kind === "install" && dialog.scope ? { initialScope: dialog.scope } : {})}
        onClose={() => setDialog({ kind: "none" })}
      />
      <RemoveDialog
        open={dialog.kind === "remove"}
        entry={dialog.kind === "remove" ? dialog.entry : null}
        status={
          dialog.kind === "remove"
            ? bundle.statusByName[`${dialog.entry.type}:${dialog.entry.name}`]
            : undefined
        }
        projectId={projectId}
        onClose={() => setDialog({ kind: "none" })}
      />
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

type EntryDetailProps = {
  entry: LibraryEntry
  status: StatusByScope | undefined
  projectId: string | null
  pushPending: boolean
  pushError: string | null
  onInstall: (scope?: InstallScope) => void
  onRemove: () => void
  onPush: (scope: InstallScope) => void
}

const EntryDetail = ({
  entry,
  status,
  projectId,
  pushPending,
  pushError,
  onInstall,
  onRemove,
  onPush,
}: EntryDetailProps) => {
  const badge = sourceBadge(entry.source)
  const canLocal = projectId !== null
  const globalInstalled = status?.global === "installed"
  const localInstalled = status?.local === "installed"
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
        <div className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-slate-200 dark:border-slate-800">
          <button
            type="button"
            data-testid={`library-action-install-global-${entry.name}`}
            onClick={() => onInstall("global")}
            className="text-xs rounded px-2 py-1 bg-sky-600 text-white hover:bg-sky-500"
          >
            {globalInstalled ? "Reinstall global" : "Install global"}
          </button>
          <button
            type="button"
            data-testid={`library-action-install-local-${entry.name}`}
            disabled={!canLocal}
            onClick={() => onInstall("local")}
            className="text-xs rounded px-2 py-1 bg-sky-600 text-white hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed"
            title={canLocal ? undefined : "open a project to install locally"}
          >
            {localInstalled ? "Reinstall local" : "Install local"}
          </button>
          <button
            type="button"
            data-testid={`library-action-push-global-${entry.name}`}
            disabled={!globalInstalled || pushPending}
            onClick={() => onPush("global")}
            className="text-xs rounded px-2 py-1 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
            title={globalInstalled ? undefined : "install globally first"}
          >
            {pushPending ? "Pushing…" : "Push from global"}
          </button>
          <button
            type="button"
            data-testid={`library-action-remove-${entry.name}`}
            onClick={onRemove}
            className="text-xs rounded px-2 py-1 border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/30 ml-auto"
          >
            Remove
          </button>
        </div>
        {pushError ? <div className="text-[11px] text-rose-600">{pushError}</div> : null}
      </div>
    </article>
  )
}
