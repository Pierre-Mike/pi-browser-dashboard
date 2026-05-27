import { useState } from "react"
import { AgenticBrowser } from "./AgenticBrowser"
import { CatalogList } from "./CatalogList"
import { LIBRARY_CATEGORIES, type LibraryCategory } from "./types"
import { useCatalog } from "./useLibrary"

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

  if (q.isLoading) return <div className="text-sm text-slate-500">Loading catalog…</div>
  if (q.isError) {
    const msg = q.error instanceof Error ? q.error.message : "unknown error"
    if (msg.includes("HTTP 404")) {
      return (
        <div
          data-testid="library-catalog-missing"
          className="text-sm text-slate-500 dark:text-slate-400 py-6 text-center border border-dashed border-slate-300 dark:border-slate-800 rounded-lg"
        >
          No <span className="font-mono">library.yaml</span> found. Run{" "}
          <span className="font-mono">/library install</span> in Claude Code to create the catalog,
          then refresh.
        </div>
      )
    }
    return <div className="text-sm text-rose-600">Failed to load catalog: {msg}</div>
  }
  const bundle = q.data
  if (!bundle) return null

  return (
    <div data-testid="library-panel" className="flex flex-col gap-3">
      <header className="flex flex-wrap items-baseline gap-2 text-xs text-slate-500 dark:text-slate-400">
        <span className="font-mono">{bundle.catalogPath}</span>
        <CountChip n={bundle.catalog.entries.length} label="entries" />
      </header>
      <nav
        role="tablist"
        aria-label="Library categories"
        data-testid="library-tabs"
        className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-800 overflow-x-auto"
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
                  ? "border-sky-500 text-sky-700 dark:text-sky-300"
                  : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
              }`}
            >
              {t.label}
            </button>
          )
        })}
      </nav>

      {LIBRARY_CATEGORIES.map((cat) => (
        <div key={cat} className={tab === cat ? "" : "hidden"}>
          <CatalogList bundle={bundle} category={cat} />
        </div>
      ))}

      <div className={tab === "hooks" ? "" : "hidden"}>
        <HooksPlaceholder />
      </div>

      <div className={tab === "agentic" ? "flex flex-col gap-2" : "hidden"}>
        <nav className="flex items-center gap-1 text-xs">
          <span className="text-slate-500 mr-1">Category:</span>
          {LIBRARY_CATEGORIES.map((cat) => {
            const active = agenticCategory === cat
            return (
              <button
                key={cat}
                type="button"
                data-testid={`agentic-category-${cat}`}
                onClick={() => setAgenticCategory(cat)}
                className={`rounded px-2 py-1 ${
                  active
                    ? "bg-sky-100 dark:bg-sky-900/40 text-sky-800 dark:text-sky-200"
                    : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                {cat}
              </button>
            )
          })}
        </nav>
        <AgenticBrowser category={agenticCategory} />
      </div>
    </div>
  )
}

const CountChip = ({ n, label }: { n: number; label: string }) => (
  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 font-medium">
    <span className="font-mono tabular-nums">{n}</span>
    <span className="opacity-80">{label}</span>
  </span>
)

const HooksPlaceholder = () => (
  <div className="text-sm text-slate-500 dark:text-slate-400 py-6 text-center border border-dashed border-slate-300 dark:border-slate-800 rounded-lg">
    Hooks editor lands in a follow-up. Until then, view configured hooks under the{" "}
    <span className="font-mono">Claude</span> tab.
  </div>
)
