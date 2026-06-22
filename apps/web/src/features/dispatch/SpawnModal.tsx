import { useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type { Project } from "../../lib/types"
import { appendPath } from "../uploads/appendPath"
import { subscribeDroppedPaths } from "../uploads/dropEvents"
import { prependSkill } from "./prependSkill"
import { SpawnSkillPicker } from "./SpawnSkillPicker"
import { dispatchSpawn } from "./spawnDispatch"
import { DEFAULT_SPAWN_EFFORT, SPAWN_EFFORT_LEVELS } from "./spawnEffort"
import { SPAWN_INTENT_INPUT, SPAWN_MODAL_SHELL } from "./spawnModalLayout"
import { useSpawnSkills } from "./useSpawnSkills"

type Props = {
  open: boolean
  project: Project | null
  onClose: () => void
}

export const SpawnModal = ({ open, project, onClose }: Props) => {
  const qc = useQueryClient()
  const [intent, setIntent] = useState("")
  const [effort, setEffort] = useState<string>(DEFAULT_SPAWN_EFFORT)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const skillState = useSpawnSkills(open, project)

  const handleClose = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["claude-config", "project"] })
    onClose()
  }, [qc, onClose])

  useEffect(() => {
    if (!open) return
    setIntent("")
    setEffort(DEFAULT_SPAWN_EFFORT)
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
    const text = prependSkill(skillState.selected, intent).trim()
    if (!text || busy) return
    setBusy(true)
    try {
      await dispatchSpawn({ intent: text, project, effort })
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
        <SpawnSkillPicker skills={skillState} disabled={busy} />
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
          <label className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            Effort
            <select
              data-testid="spawn-effort"
              value={effort}
              onChange={(e) => setEffort(e.target.value)}
              disabled={busy}
              className="select select-xs select-bordered normal-case"
            >
              <option value={DEFAULT_SPAWN_EFFORT}>default</option>
              {SPAWN_EFFORT_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-400">⌘/Ctrl + ⏎ to spawn</span>
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
              disabled={busy || prependSkill(skillState.selected, intent).trim().length === 0}
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
