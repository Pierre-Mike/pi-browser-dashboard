import { useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { api } from "../../lib/api"
import type { Project } from "../../lib/types"
import { useGlobalClaudeConfig, useProjectClaudeConfig } from "../claude-config/useClaudeConfig"
import { appendPath } from "../uploads/appendPath"
import { subscribeDroppedPaths } from "../uploads/dropEvents"
import { prependSkill } from "./prependSkill"
import { mergeSkillOptions } from "./skillOptions"
import { SPAWN_INTENT_INPUT, SPAWN_MODAL_SHELL, SPAWN_SKILLS_CONTAINER } from "./spawnModalLayout"

type Props = {
  open: boolean
  project: Project | null
  onClose: () => void
}

const DEFAULT_SKILL = "goal"

export const SpawnModal = ({ open, project, onClose }: Props) => {
  const qc = useQueryClient()
  const [intent, setIntent] = useState("")
  const [skills, setSkills] = useState<string[]>([DEFAULT_SKILL])
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const claudeConfig = useGlobalClaudeConfig()
  const projectConfig = useProjectClaudeConfig(project?.id ?? "")

  const skillOptions = useMemo(
    () =>
      mergeSkillOptions({
        defaultSkill: DEFAULT_SKILL,
        globalSkills: claudeConfig.data?.skills,
        projectSkills: project ? projectConfig.data?.skills : [],
      }),
    [claudeConfig.data, projectConfig.data, project],
  )

  const handleClose = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["claude-config", "project"] })
    onClose()
  }, [qc, onClose])

  const toggleSkill = (id: string) =>
    setSkills((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]))

  useEffect(() => {
    if (!open) return
    setIntent("")
    setSkills([DEFAULT_SKILL])
    const t = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, handleClose])

  useEffect(() => {
    if (!open) return
    return subscribeDroppedPaths((path) => {
      setIntent((prev) => appendPath(prev, path))
    })
  }, [open])

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    const text = prependSkill(skills, intent).trim()
    if (!text || busy) return
    setBusy(true)
    try {
      const body: { intent: string; cwd?: string } = { intent: text }
      if (project) body.cwd = project.path
      // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
      const client = api as any
      await client.dispatch.$post({ json: body })
      qc.invalidateQueries({ queryKey: ["sessions"] })
      handleClose()
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
      onClick={handleClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") handleClose()
      }}
      role="presentation"
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="presentation"
        className={SPAWN_MODAL_SHELL}
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
        <fieldset
          data-testid="spawn-skill"
          className="flex flex-col gap-1.5 text-xs text-slate-500 dark:text-slate-400"
        >
          <legend className="shrink-0">Skills (select any)</legend>
          <div className={SPAWN_SKILLS_CONTAINER}>
            {skillOptions.map((id) => {
              const selected = skills.includes(id)
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={selected}
                  data-skill={id}
                  data-selected={selected}
                  onClick={() => toggleSkill(id)}
                  disabled={busy}
                  className={`btn btn-xs h-auto min-h-0 rounded-full py-1 font-mono normal-case ${
                    selected ? "btn-primary" : "btn-outline border-slate-300 dark:border-slate-700"
                  }`}
                >
                  /{id}
                </button>
              )
            })}
          </div>
        </fieldset>
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
          className={SPAWN_INTENT_INPUT}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-slate-400">⌘/Ctrl + ⏎ to spawn</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={busy}
              className="btn btn-sm btn-ghost normal-case"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || prependSkill(skills, intent).trim().length === 0}
              className="btn btn-sm btn-primary normal-case shadow-sm shadow-primary/30"
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
