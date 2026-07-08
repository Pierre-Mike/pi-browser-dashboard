import { useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type { Project } from "../../lib/types"
import { appendPath } from "../uploads/appendPath"
import { subscribeDroppedPaths } from "../uploads/dropEvents"
import { prependSkill } from "./prependSkill"
import { SpawnCommandPreview } from "./SpawnCommandPreview"
import { SpawnSkillPicker } from "./SpawnSkillPicker"
import { SpawnToolPicker } from "./SpawnToolPicker"
import { dispatchSpawn } from "./spawnDispatch"
import { DEFAULT_SPAWN_EFFORT, SPAWN_EFFORT_LEVELS } from "./spawnEffort"
import {
  DEFAULT_SPAWN_HARNESS,
  HARNESS_LABELS,
  HARNESS_SKILL_PREFIXES,
  SPAWN_HARNESSES,
  type SpawnHarness,
} from "./spawnHarness"
import { SPAWN_INTENT_INPUT, SPAWN_MODAL_SHELL } from "./spawnModalLayout"
import { DEFAULT_SPAWN_MODEL, SPAWN_MODEL_ALIASES } from "./spawnModel"
import { DEFAULT_SPAWN_THINKING, PI_THINKING_LEVELS } from "./spawnThinking"
import { HARNESS_SPAWN_TOOLS, toggleTool, toolsForDispatch } from "./spawnTools"
import { piModelValue, usePiModels } from "./usePiModels"
import { useSpawnSkills } from "./useSpawnSkills"

type Props = {
  open: boolean
  project: Project | null
  onClose: () => void
}

export const SpawnModal = ({ open, project, onClose }: Props) => {
  const qc = useQueryClient()
  const [harness, setHarness] = useState<SpawnHarness>(DEFAULT_SPAWN_HARNESS)
  const [intent, setIntent] = useState("")
  const [effort, setEffort] = useState<string>(DEFAULT_SPAWN_EFFORT)
  const [thinking, setThinking] = useState<string>(DEFAULT_SPAWN_THINKING)
  const [model, setModel] = useState<string>(DEFAULT_SPAWN_MODEL)
  const [tools, setTools] = useState<readonly string[]>(HARNESS_SPAWN_TOOLS[DEFAULT_SPAWN_HARNESS])
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const skillState = useSpawnSkills(open, project)
  const piModels = usePiModels(open && harness === "pi")

  const harnessTools = HARNESS_SPAWN_TOOLS[harness]
  const skillPrefix = HARNESS_SKILL_PREFIXES[harness]

  const handleClose = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["claude-config", "project"] })
    onClose()
  }, [qc, onClose])

  // Switching harness keeps the intent and skill selection (they carry over)
  // but resets the harness-owned knobs: tool set, model catalog, and the
  // effort/thinking level, which don't share a vocabulary between CLIs.
  const switchHarness = (next: SpawnHarness) => {
    if (next === harness) return
    setHarness(next)
    setTools(HARNESS_SPAWN_TOOLS[next])
    setModel(DEFAULT_SPAWN_MODEL)
    setEffort(DEFAULT_SPAWN_EFFORT)
    setThinking(DEFAULT_SPAWN_THINKING)
  }

  useEffect(() => {
    if (!open) return
    setHarness(DEFAULT_SPAWN_HARNESS)
    setIntent("")
    setEffort(DEFAULT_SPAWN_EFFORT)
    setThinking(DEFAULT_SPAWN_THINKING)
    setModel(DEFAULT_SPAWN_MODEL)
    setTools(HARNESS_SPAWN_TOOLS[DEFAULT_SPAWN_HARNESS])
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
    const text = prependSkill({ skills: skillState.selected, intent, skillPrefix }).trim()
    if (!text || busy) return
    setBusy(true)
    try {
      await dispatchSpawn({
        intent: text,
        project,
        harness,
        effort,
        thinking,
        model,
        tools: toolsForDispatch(tools, harnessTools),
      })
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
              className="text-[11px] text-base-content/60 truncate max-w-[16rem]"
              title={project.path}
            >
              {project.path}
            </span>
          ) : null}
        </div>
        <div
          role="tablist"
          data-testid="spawn-harness-tabs"
          className="tabs tabs-boxed tabs-sm w-fit"
        >
          {SPAWN_HARNESSES.map((h) => (
            <button
              key={h}
              type="button"
              role="tab"
              aria-selected={harness === h}
              data-testid={`spawn-harness-${h}`}
              data-active={harness === h}
              onClick={() => switchHarness(h)}
              disabled={busy}
              className={`tab normal-case ${harness === h ? "tab-active" : ""}`}
            >
              {HARNESS_LABELS[h]}
            </button>
          ))}
        </div>
        <SpawnSkillPicker skills={skillState} disabled={busy} />
        <SpawnToolPicker
          all={harnessTools}
          selected={tools}
          onToggle={(id) =>
            setTools((prev) => toggleTool({ selected: prev, id, all: harnessTools }))
          }
          disabled={busy}
        />
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
        <SpawnCommandPreview
          harness={harness}
          intent={prependSkill({ skills: skillState.selected, intent, skillPrefix }).trim()}
          effort={effort}
          thinking={thinking}
          model={model}
          tools={toolsForDispatch(tools, harnessTools)}
          cwd={project?.path}
        />
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            {harness === "pi" ? (
              <label className="flex items-center gap-1.5 text-[11px] text-base-content/60">
                Thinking
                <select
                  data-testid="spawn-thinking"
                  value={thinking}
                  onChange={(e) => setThinking(e.target.value)}
                  disabled={busy}
                  className="select select-xs select-bordered normal-case"
                >
                  <option value={DEFAULT_SPAWN_THINKING}>default</option>
                  {PI_THINKING_LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="flex items-center gap-1.5 text-[11px] text-base-content/60">
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
            )}
            <label className="flex items-center gap-1.5 text-[11px] text-base-content/60">
              Model
              <select
                data-testid="spawn-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={busy}
                className="select select-xs select-bordered normal-case"
              >
                <option value={DEFAULT_SPAWN_MODEL}>default</option>
                {harness === "pi"
                  ? (piModels.data ?? []).map((m) => {
                      const value = piModelValue(m)
                      return (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      )
                    })
                  : SPAWN_MODEL_ALIASES.map((alias) => (
                      <option key={alias} value={alias}>
                        {alias}
                      </option>
                    ))}
              </select>
            </label>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-base-content/60">⌘/Ctrl + ⏎ to spawn</span>
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
              disabled={
                busy ||
                prependSkill({ skills: skillState.selected, intent, skillPrefix }).trim().length ===
                  0
              }
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
