import { useQueryClient } from "@tanstack/react-query"
import { api } from "../../lib/api"
import type { ExtensionManifest } from "./types"
import { useExtensions } from "./useExtensions"

// Known capability keys exposed in the management UI.
const CAPABILITIES = ["fs", "exec", "net", "events", "git"] as const
type Capability = (typeof CAPABILITIES)[number]

const TIER_COLORS: Record<string, string> = {
  iframe: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  esm: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
}

type ExtRowProps = { ext: ExtensionManifest }

const ExtRow = ({ ext }: ExtRowProps) => {
  const qc = useQueryClient()

  const invalidate = () => qc.invalidateQueries({ queryKey: ["extensions"] })

  const toggle = async () => {
    // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
    const client = api as any
    if (ext.enabled) {
      await client.extensions[ext.name].disable.$post()
    } else {
      await client.extensions[ext.name].enable.$post()
    }
    await invalidate()
  }

  const toggleGrant = async (cap: Capability) => {
    // Build the new grants object — toggling one capability.
    const hasFs = ext.granted.includes("fs")
    const hasExec = ext.granted.includes("exec")
    const hasNet = ext.granted.includes("net")
    const hasEvents = ext.granted.includes("events")
    const hasGit = ext.granted.includes("git")

    const newGrants: Record<string, string[] | boolean> = {
      fs: hasFs ? ["*"] : [],
      exec: hasExec ? ["*"] : [],
      net: hasNet ? ["*"] : [],
      events: hasEvents,
      git: hasGit,
    }

    // Toggle the target cap (events/git are booleans; fs/exec/net are lists).
    if (cap === "events" || cap === "git") {
      newGrants[cap] = !ext.granted.includes(cap)
    } else {
      const had = ext.granted.includes(cap)
      newGrants[cap] = had ? [] : ["*"]
    }

    // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
    const client = api as any
    await client.extensions[ext.name].grants.$post({ json: newGrants })
    await invalidate()
  }

  return (
    <div
      data-testid={`ext-row-${ext.name}`}
      className="flex flex-col gap-2 rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-900"
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-sm font-semibold text-slate-800 dark:text-slate-100">
          {ext.name}
        </span>
        <span
          className={`text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 font-medium ${TIER_COLORS[ext.tier] ?? ""}`}
        >
          {ext.tier}
        </span>
        <span className="text-[11px] text-slate-400 dark:text-slate-500">{ext.scope}</span>
        <span className="text-[11px] text-slate-400 dark:text-slate-500">v{ext.version}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            {ext.enabled ? "enabled" : "disabled"}
          </span>
          <button
            type="button"
            data-testid={`ext-enable-${ext.name}`}
            aria-label={ext.enabled ? `Disable ${ext.name}` : `Enable ${ext.name}`}
            onClick={toggle}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
              ext.enabled ? "bg-sky-500 dark:bg-sky-600" : "bg-slate-300 dark:bg-slate-600"
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                ext.enabled ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {CAPABILITIES.map((cap) => {
          const isGranted = ext.granted.includes(cap)
          return (
            <label key={cap} className="flex items-center gap-1 text-xs cursor-pointer select-none">
              <input
                type="checkbox"
                data-testid={`ext-grant-${ext.name}-${cap}`}
                checked={isGranted}
                onChange={() => toggleGrant(cap)}
                className="h-3.5 w-3.5 rounded border-slate-300 dark:border-slate-600 text-sky-500 focus:ring-sky-400"
              />
              <span
                className={
                  isGranted
                    ? "text-slate-700 dark:text-slate-200"
                    : "text-slate-400 dark:text-slate-500"
                }
              >
                {cap}
              </span>
            </label>
          )
        })}
      </div>
    </div>
  )
}

export const ExtensionsPanel = () => {
  const q = useExtensions()

  if (q.isLoading) {
    return <div className="text-sm text-slate-500">Loading extensions…</div>
  }
  if (q.isError) {
    return (
      <div className="text-sm text-rose-600">
        Failed to load extensions: {q.error instanceof Error ? q.error.message : "unknown error"}
      </div>
    )
  }

  const exts = q.data ?? []

  if (exts.length === 0) {
    return (
      <div className="text-sm text-slate-500 py-8 text-center border border-dashed border-slate-300 dark:border-slate-700 rounded-lg">
        No extensions installed.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2" data-testid="extensions-panel">
      {exts.map((ext) => (
        <ExtRow key={ext.name} ext={ext} />
      ))}
    </div>
  )
}
