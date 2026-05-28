import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { api } from "../../lib/api"
import type { Project } from "../../lib/types"
import { useGlobalClaudeConfig } from "../claude-config/useClaudeConfig"
import { appendPath } from "../uploads/appendPath"
import { subscribeDroppedPaths } from "../uploads/dropEvents"
import { prependSkill } from "./prependSkill"

type Props = {
  open: boolean
  project: Project | null
  onClose: () => void
}

const DEFAULT_SKILL = "goal"
const NO_SKILL = ""

export const SpawnModal = ({ open, project, onClose }: Props) => {
  const qc = useQueryClient()
  const [intent, setIntent] = useState("")
  const [skill, setSkill] = useState(DEFAULT_SKILL)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const claudeConfig = useGlobalClaudeConfig()

  const skillOptions = useMemo(() => {
    const ids = (claudeConfig.data?.skills ?? []).map((s) => s.id)
    // Always surface the default even if the dir scan hasn't returned yet, so
    // the dropdown isn't blank on first paint.
    if (!ids.includes(DEFAULT_SKILL)) ids.unshift(DEFAULT_SKILL)
    return ids
  }, [claudeConfig.data])

  useEffect(() => {
    if (!open) return
    setIntent("")
    setSkill(DEFAULT_SKILL)
    const t = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    return subscribeDroppedPaths((path) => {
      setIntent((prev) => appendPath(prev, path))
    })
  }, [open])

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    const text = prependSkill(skill, intent).trim()
    if (!text || busy) return
    setBusy(true)
    try {
      const body: { intent: string; cwd?: string } = { intent: text }
      if (project) body.cwd = project.path
      // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
      const client = api as any
      await client.dispatch.$post({ json: body })
      qc.invalidateQueries({ queryKey: ["sessions"] })
      onClose()
    } catch (err) {
      console.error("dispatch failed", err)
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null
  if (typeof document === "undefined") return null

  return createPortal(
    <div
      data-testid="spawn-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose()
      }}
      role="presentation"
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="presentation"
        className="w-full max-w-lg rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl p-4 flex flex-col gap-3"
      >
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">
            Spawn in <span className="font-mono">{project?.name ?? "no project"}</span>
          </h2>
          {project ? (
            <span
              className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[16rem]"
              title={project.path}
            >
              {project.path}
            </span>
          ) : null}
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span className="shrink-0">Skill</span>
          <select
            data-testid="spawn-skill"
            value={skill}
            onChange={(e) => setSkill(e.target.value)}
            disabled={busy}
            className="flex-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 text-sm font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-400"
          >
            <option value={NO_SKILL}>(none)</option>
            {skillOptions.map((id) => (
              <option key={id} value={id}>
                /{id}
              </option>
            ))}
          </select>
        </label>
        <textarea
          ref={inputRef}
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              submit(e as unknown as React.FormEvent)
            }
          }}
          rows={4}
          placeholder="What should this session do?"
          disabled={busy}
          className="w-full resize-none rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-slate-400">⌘/Ctrl + ⏎ to spawn</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="text-sm rounded-md border border-slate-300 dark:border-slate-700 px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || intent.trim().length === 0}
              className="text-sm rounded-md bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed px-3 py-1.5 font-medium text-white"
            >
              {busy ? "Spawning…" : "Spawn"}
            </button>
          </div>
        </div>
      </form>
    </div>,
    document.body,
  )
}
