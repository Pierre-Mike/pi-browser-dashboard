import { useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { api } from "../../lib/api"
import type { Project } from "../../lib/types"

type Props = { project: Project }

export const InlineSpawn = ({ project }: Props) => {
  const qc = useQueryClient()
  const [intent, setIntent] = useState("")
  const [busy, setBusy] = useState(false)

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    const text = intent.trim()
    if (!text || busy) return
    setBusy(true)
    try {
      // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
      const client = api as any
      await client.dispatch.$post({ json: { intent: text, cwd: project.path } })
      qc.invalidateQueries({ queryKey: ["sessions"] })
      setIntent("")
    } catch (err) {
      console.error("dispatch failed", err)
    } finally {
      setBusy(false)
    }
  }

  const disabled = busy || intent.trim().length === 0

  return (
    <form
      data-testid="inline-spawn"
      onSubmit={submit}
      className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-3 flex flex-col gap-2"
    >
      <textarea
        data-testid="inline-spawn-input"
        value={intent}
        onChange={(e) => setIntent(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            submit(e as unknown as React.FormEvent)
          }
        }}
        rows={2}
        placeholder={`Spawn in ${project.name} — what should this session do?`}
        disabled={busy}
        className="w-full resize-none rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-slate-400">⌘/Ctrl + ⏎ to spawn</span>
        <button
          type="submit"
          data-testid="inline-spawn-submit"
          disabled={disabled}
          className="text-sm rounded-md bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed px-3 py-1.5 font-medium text-white"
        >
          {busy ? "Spawning…" : "Spawn"}
        </button>
      </div>
    </form>
  )
}
