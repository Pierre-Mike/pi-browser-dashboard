import { SPAWN_SKILLS_CONTAINER } from "./spawnModalLayout"
import type { SpawnSkills } from "./useSpawnSkills"

type Props = {
  skills: SpawnSkills
  disabled: boolean
}

// The skill-selection fieldset for the spawn modal: a toggle button per skill
// plus, when a project is in scope, a "set as project default" control backed by
// the project's pid-settings. Split out of SpawnModal to keep that component thin.
export const SpawnSkillPicker = ({ skills, disabled }: Props) => (
  <fieldset
    data-testid="spawn-skill"
    className="flex flex-col gap-1.5 text-xs text-slate-500 dark:text-slate-400"
  >
    <legend className="shrink-0">Skills (select any)</legend>
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
            className={`rounded-full border px-2.5 py-1 text-xs font-mono transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              selected
                ? "border-sky-500 bg-sky-600 text-white"
                : "border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            }`}
          >
            /{id}
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
          className="shrink-0 rounded-md border border-slate-300 dark:border-slate-700 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
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
