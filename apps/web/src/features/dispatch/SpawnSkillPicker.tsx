import { useState } from "react"
import { SPAWN_SKILLS_CONTAINER, skillChipClass } from "./spawnModalLayout"
import type { SpawnSkills } from "./useSpawnSkills"

type Props = {
  skills: SpawnSkills
  disabled: boolean
}

// The skill-selection fieldset for the spawn modal: a toggle chip per skill, a
// "groups" row to apply/save named presets (from global settings), plus — when a
// project is in scope — a "set as project default" control backed by the
// project's pid-settings. Split out of SpawnModal to keep that component thin.
export const SpawnSkillPicker = ({ skills, disabled }: Props) => {
  const [groupName, setGroupName] = useState("")
  const canSaveGroup = groupName.trim().length > 0 && skills.selected.length > 0

  return (
    <fieldset
      data-testid="spawn-skill"
      className="flex flex-col gap-1.5 text-xs text-base-content/60"
    >
      <legend className="shrink-0 px-0 font-medium text-base-content/80">
        Skills{" "}
        <span className="font-normal text-base-content/60">
          · {skills.selected.length ? `${skills.selected.length} selected` : "select any"}
        </span>
      </legend>
      <div className={SPAWN_SKILLS_CONTAINER}>
        {skills.options.map((id) => {
          const selected = skills.selected.includes(id)
          return (
            <button
              key={id}
              type="button"
              aria-pressed={selected}
              data-skill={id}
              data-selected={selected}
              onClick={() => skills.toggle(id)}
              disabled={disabled}
              className={skillChipClass(selected)}
            >
              {selected ? <span aria-hidden="true">✓</span> : null}/{id}
            </button>
          )
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {skills.groups.length > 0 ? (
          <select
            data-testid="spawn-apply-group"
            value=""
            disabled={disabled}
            onChange={(e) => {
              if (e.target.value) skills.applyGroup(e.target.value)
            }}
            className="select select-xs select-bordered normal-case"
          >
            <option value="">Apply group…</option>
            {skills.groups.map((g) => (
              <option key={g.name} value={g.name}>
                {g.name} ({g.skills.length})
              </option>
            ))}
          </select>
        ) : null}
        <input
          data-testid="spawn-group-name"
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
          placeholder="New group name"
          disabled={disabled}
          className="input input-xs input-bordered grow normal-case sm:grow-0"
        />
        <button
          type="button"
          data-testid="spawn-save-group"
          onClick={() => {
            skills.saveAsGroup(groupName)
            setGroupName("")
          }}
          disabled={disabled || skills.savingGroup || !canSaveGroup}
          className="btn btn-xs btn-ghost h-auto min-h-0 shrink-0 gap-1 rounded-md border border-base-300 px-2 py-0.5 text-[11px] font-medium normal-case text-base-content/80 hover:border-base-300"
        >
          {skills.savingGroup ? "Saving…" : "Save as group"}
        </button>
      </div>
      {skills.canManageDefault ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-base-content/60">
            Pre-selected from this project's pid-settings.
          </span>
          <button
            type="button"
            data-testid="spawn-set-default"
            onClick={skills.saveAsDefault}
            disabled={disabled || skills.savePending || skills.isProjectDefault}
            className="btn btn-xs btn-ghost h-auto min-h-0 shrink-0 gap-1 rounded-md border border-base-300 px-2 py-0.5 text-[11px] font-medium normal-case text-base-content/80 hover:border-base-300"
          >
            {skills.savePending
              ? "Saving…"
              : skills.isProjectDefault
                ? "✓ Project default"
                : "Set as project default"}
          </button>
        </div>
      ) : null}
    </fieldset>
  )
}
