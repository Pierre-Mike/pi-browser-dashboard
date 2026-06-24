import { useEffect, useMemo, useState } from "react"
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
  // When set (e.g. via the global search), select this entry on mount/change.
  focusName?: string
}

type DialogState =
  | { kind: "none" }
  | { kind: "install"; entry: LibraryEntry; scope?: InstallScope }
  | { kind: "remove"; entry: LibraryEntry }

export const CatalogList = ({ bundle, category, projectId, focusName }: Props) => {
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<string | null>(null)
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" })
  const pushM = usePushMutation()

  // Honour an external focus request (global search jump): clear any active
  // filter so the entry is visible, then select it.
  useEffect(() => {
    if (focusName) {
      setQuery("")
      setSelected(focusName)
    }
  }, [focusName])

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
      <div className="text-sm text-base-content/60 py-6 text-center border border-dashed border-base-300 rounded-lg">
        No {category} registered in the catalog.
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-2">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`Search ${category}…`}
        data-testid={`library-search-${category}`}
        className="input input-bordered input-sm text-xs"
      />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 flex-1 min-h-0">
        <ul className="md:col-span-1 flex flex-col gap-1 min-h-0 overflow-auto pr-1">
          {entries.length === 0 ? (
            <li className="text-xs text-base-content/60 py-2">No matches.</li>
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
                    active ? "border-primary bg-primary/10" : "border-base-300 hover:bg-base-200"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate">{entry.name}</span>
                    <StatusChips status={status} />
                  </div>
                  {entry.description ? (
                    <div className="text-[11px] text-base-content/60 line-clamp-2 mt-0.5">
                      {entry.description}
                    </div>
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>
        <div className="md:col-span-2 min-h-0 overflow-auto">
          {selectedEntry === null ? (
            <div className="text-sm text-base-content/60 border border-dashed border-base-300 rounded-lg py-8 text-center">
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
      installed ? "bg-success/15 text-success" : "bg-base-200 text-base-content/60"
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
      tone: "bg-base-200 text-base-content/80",
    }
  }
  if (source.includes("github.com") || source.includes("raw.githubusercontent.com")) {
    return {
      label: "GitHub",
      tone: "bg-secondary/15 text-secondary",
    }
  }
  return {
    label: "other",
    tone: "bg-warning/15 text-warning",
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
      className="rounded-md border border-base-300 bg-base-100 flex flex-col gap-2"
    >
      <header className="flex flex-wrap items-baseline gap-2 px-3 py-2 border-b border-base-300">
        <h4 className="text-sm font-semibold">{entry.name}</h4>
        <span
          className={`text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 font-medium ${badge.tone}`}
        >
          {badge.label}
        </span>
        <StatusChips status={status} />
      </header>
      <div className="px-3 pb-2 flex flex-col gap-2 text-xs">
        {entry.description ? <p className="text-base-content/80">{entry.description}</p> : null}
        <div>
          <span className="text-base-content/60">source:</span>{" "}
          <span className="font-mono break-all">{entry.source}</span>
        </div>
        {entry.requires && entry.requires.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-base-content/60">requires:</span>
            {entry.requires.map((r) => (
              <span key={r} className="font-mono text-[10px] rounded bg-base-200 px-1.5 py-0.5">
                {r}
              </span>
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-base-300">
          <button
            type="button"
            data-testid={`library-action-install-global-${entry.name}`}
            onClick={() => onInstall("global")}
            className="btn btn-sm btn-primary"
          >
            {globalInstalled ? "Reinstall global" : "Install global"}
          </button>
          <button
            type="button"
            data-testid={`library-action-install-local-${entry.name}`}
            disabled={!canLocal}
            onClick={() => onInstall("local")}
            className="btn btn-sm btn-primary"
            title={canLocal ? undefined : "open a project to install locally"}
          >
            {localInstalled ? "Reinstall local" : "Install local"}
          </button>
          <button
            type="button"
            data-testid={`library-action-push-global-${entry.name}`}
            disabled={!globalInstalled || pushPending}
            onClick={() => onPush("global")}
            className="btn btn-sm btn-ghost border border-base-300"
            title={globalInstalled ? undefined : "install globally first"}
          >
            {pushPending ? "Pushing…" : "Push from global"}
          </button>
          <button
            type="button"
            data-testid={`library-action-push-local-${entry.name}`}
            disabled={!localInstalled || pushPending}
            onClick={() => onPush("local")}
            className="btn btn-sm btn-ghost border border-base-300"
            title={
              canLocal
                ? localInstalled
                  ? undefined
                  : "install locally first"
                : "open a project to push locally"
            }
          >
            {pushPending ? "Pushing…" : "Push from local"}
          </button>
          <button
            type="button"
            data-testid={`library-action-remove-${entry.name}`}
            onClick={onRemove}
            className="btn btn-sm btn-ghost border border-error/40 text-error hover:bg-error/10 ml-auto"
          >
            Remove
          </button>
        </div>
        {pushError ? <div className="text-[11px] text-error">{pushError}</div> : null}
      </div>
    </article>
  )
}
