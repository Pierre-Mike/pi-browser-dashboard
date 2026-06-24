import { useState } from "react"
import { AgenticBrowser } from "./AgenticBrowser"
import { CatalogList } from "./CatalogList"
import { AddDialog } from "./dialogs/AddDialog"
import { GlobalSearch } from "./GlobalSearch"
import { LibrarySetupCard } from "./LibrarySetupCard"
import { type InstallScope, LIBRARY_CATEGORIES, type LibraryCategory } from "./types"
import { useCatalog, useSyncMutation } from "./useLibrary"

type Tab = { key: LibraryCategory | "hooks" | "agentic"; label: string }

const TABS: readonly Tab[] = [
  { key: "skills", label: "Skills" },
  { key: "agents", label: "Agents" },
  { key: "tools", label: "Tools" },
  { key: "prompts", label: "Prompts" },
  { key: "statuslines", label: "Statuslines" },
  { key: "extensions", label: "Extensions" },
  { key: "hooks", label: "Hooks" },
  { key: "agentic", label: "Agentic repo" },
]

type Props = { scope: "global"; projectId?: undefined } | { scope: "project"; projectId: string }

export const LibraryPanel = (props: Props) => {
  const projectId = props.scope === "project" ? props.projectId : null
  const q = useCatalog(projectId)
  const [tab, setTab] = useState<Tab["key"]>("skills")
  const [agenticCategory, setAgenticCategory] = useState<LibraryCategory>("skills")
  const [addOpen, setAddOpen] = useState(false)
  const [addDefaults, setAddDefaults] = useState<
    { name?: string; type?: LibraryCategory; source?: string } | undefined
  >(undefined)
  const [syncScope, setSyncScope] = useState<"all" | InstallScope>("all")
  const [focus, setFocus] = useState<{ category: LibraryCategory; name: string } | null>(null)
  const syncM = useSyncMutation()

  if (q.isLoading)
    return (
      <div className="flex items-center gap-2 text-sm text-base-content/60">
        <span className="loading loading-spinner loading-sm" />
        Loading catalog…
      </div>
    )
  if (q.isError) {
    const msg = q.error instanceof Error ? q.error.message : "unknown error"
    if (msg.includes("HTTP 404")) {
      return <LibrarySetupCard />
    }
    return <div className="alert alert-error text-sm">Failed to load catalog: {msg}</div>
  }
  const bundle = q.data
  if (!bundle) return null

  return (
    <div data-testid="library-panel" className="flex flex-col flex-1 min-h-0 gap-3">
      <header className="flex flex-wrap items-baseline gap-2 text-xs text-base-content/60">
        <span className="font-mono">{bundle.catalogPath}</span>
        <CountChip n={bundle.catalog.entries.length} label="entries" />
        <span className="ml-auto flex items-center gap-2">
          <button
            type="button"
            data-testid="library-action-add"
            onClick={() => {
              setAddDefaults(undefined)
              setAddOpen(true)
            }}
            className="btn btn-sm btn-primary normal-case shadow-sm shadow-primary/30"
          >
            + Add entry
          </button>
          <span className="inline-flex items-center rounded-lg border border-base-300 overflow-hidden bg-base-100">
            <select
              value={syncScope}
              onChange={(e) => setSyncScope(e.target.value as "all" | InstallScope)}
              data-testid="library-sync-scope"
              title={projectId ? undefined : "open a project to sync local"}
              className="select select-sm select-bordered border-0 rounded-none bg-transparent focus:outline-none"
            >
              <option value="all">all</option>
              <option value="global">global</option>
              <option value="local" disabled={projectId === null}>
                local
              </option>
            </select>
            <button
              type="button"
              data-testid="library-action-sync"
              disabled={syncM.isPending}
              onClick={() =>
                syncM.mutate(
                  syncScope === "all"
                    ? {}
                    : {
                        scope: syncScope,
                        ...(syncScope === "local" && projectId ? { projectId } : {}),
                      },
                )
              }
              className="btn btn-sm btn-ghost normal-case border-l border-base-300 rounded-none disabled:opacity-50"
            >
              {syncM.isPending ? (
                <>
                  <span className="loading loading-spinner loading-xs" />
                  Syncing…
                </>
              ) : (
                "Sync"
              )}
            </button>
          </span>
        </span>
      </header>
      <GlobalSearch
        bundle={bundle}
        onPick={(category, name) => {
          setTab(category)
          setFocus({ category, name })
        }}
      />
      {syncM.isError ? (
        <div className="alert alert-error text-xs">
          {syncM.error instanceof Error ? syncM.error.message : "sync failed"}
        </div>
      ) : null}
      {syncM.data ? (
        <div className="text-xs text-success">
          Sync: {syncM.data.outcomes.filter((o) => o.ok).length} ok /{" "}
          {syncM.data.outcomes.filter((o) => !o.ok).length} failed (of {syncM.data.outcomes.length})
        </div>
      ) : null}
      <nav
        role="tablist"
        aria-label="Library categories"
        data-testid="library-tabs"
        className="flex items-center gap-1 border-b border-base-300 overflow-x-auto"
      >
        {TABS.map((t) => {
          const active = tab === t.key
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`library-tab-${t.key}`}
              data-active={active}
              onClick={() => setTab(t.key)}
              className={`px-3 py-1 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-base-content/60 hover:text-base-content"
              }`}
            >
              {t.label}
            </button>
          )
        })}
      </nav>

      {LIBRARY_CATEGORIES.map((cat) => (
        <div key={cat} className={tab === cat ? "flex flex-col flex-1 min-h-0" : "hidden"}>
          <CatalogList
            bundle={bundle}
            category={cat}
            projectId={projectId}
            {...(focus?.category === cat ? { focusName: focus.name } : {})}
          />
        </div>
      ))}

      <div className={tab === "hooks" ? "flex-1 min-h-0 overflow-auto" : "hidden"}>
        <HooksPlaceholder />
      </div>

      <div className={tab === "agentic" ? "flex flex-col flex-1 min-h-0 gap-2" : "hidden"}>
        <nav className="flex items-center gap-1 text-xs">
          <span className="text-base-content/60 mr-1">Category:</span>
          {LIBRARY_CATEGORIES.map((cat) => {
            const active = agenticCategory === cat
            return (
              <button
                key={cat}
                type="button"
                data-testid={`agentic-category-${cat}`}
                onClick={() => setAgenticCategory(cat)}
                className={`btn btn-xs normal-case ${
                  active ? "btn-primary shadow-sm shadow-primary/30" : "btn-ghost"
                }`}
              >
                {cat}
              </button>
            )
          })}
        </nav>
        <AgenticBrowser
          category={agenticCategory}
          onRegister={(item) => {
            setAddDefaults({
              name: item.name,
              type: agenticCategory,
              source: item.path,
            })
            setAddOpen(true)
          }}
        />
      </div>
      <AddDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        {...(addDefaults ? { defaults: addDefaults } : {})}
      />
    </div>
  )
}

const CountChip = ({ n, label }: { n: number; label: string }) => (
  <span className="badge badge-sm badge-ghost gap-1 font-medium">
    <span className="font-mono tabular-nums">{n}</span>
    <span className="opacity-80">{label}</span>
  </span>
)

const HooksPlaceholder = () => (
  <div className="text-sm text-base-content/60 py-6 text-center border border-dashed border-base-300 rounded-lg bg-base-200/40">
    Hooks editor lands in a follow-up. Until then, view configured hooks under the{" "}
    <span className="font-mono">Claude</span> tab.
  </div>
)
