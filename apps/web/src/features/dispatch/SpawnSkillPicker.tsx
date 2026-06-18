import { SPAWN_SKILLS_CONTAINER, skillChipClass } from "./spawnModalLayout"
import type { SpawnSkills } from "./useSpawnSkills"

type Props = {
  skills: SpawnSkills
  disabled: boolean
}

// The skill-selection fieldset for the spawn modal: a toggle chip per skill plus,
// when a project is in scope, a "set as project default" control backed by the
// project's pid-settings. Split out of SpawnModal to keep that component thin.
export const SpawnSkillPicker = ({ skills, disabled }: Props) => (
  <fieldset
    data-testid="spawn-skill"
    className="flex flex-col gap-1.5 text-xs text-slate-500 dark:text-slate-400"
  >
    <legend className="shrink-0 px-0 font-medium text-slate-600 dark:text-slate-300">
      Skills{" "}
      <span className="font-normal text-slate-400 dark:text-slate-500">
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
    {skills.canManageDefault ? (
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-slate-400">
          Pre-selected from this project's pid-settings.
        </span>
        <button
          type="button"
          data-testid="spawn-set-default"
          onClick={skills.saveAsDefault}
          disabled={disabled || skills.savePending || skills.isProjectDefault}
          className="btn btn-xs btn-ghost h-auto min-h-0 shrink-0 gap-1 rounded-md border border-slate-300 px-2 py-0.5 text-[11px] font-medium normal-case text-slate-600 hover:border-slate-400 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-500"
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
