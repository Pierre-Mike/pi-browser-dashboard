import { SPAWN_SKILLS_CONTAINER, skillChipClass } from "./spawnModalLayout"
import { ALL_SPAWN_TOOLS } from "./spawnTools"

type Props = {
  selected: readonly string[]
  onToggle: (id: string) => void
  disabled: boolean
}

// The tool-allow fieldset for the spawn modal: one toggle pill per Claude Code
// built-in tool, all selected by default (matching the CLI's own default of
// every tool enabled). Collapsed behind a native <details> disclosure since
// the full built-in set runs 40+ entries — most spawns never touch this, so
// it stays out of the way until opened. Split out of SpawnModal to keep that
// component thin, mirroring SpawnSkillPicker.
export const SpawnToolPicker = ({ selected, onToggle, disabled }: Props) => {
  const allSelected = selected.length === ALL_SPAWN_TOOLS.length

  return (
    <details data-testid="spawn-tools" className="text-xs text-base-content/60">
      <summary className="cursor-pointer font-medium text-base-content/80">
        Tools{" "}
        <span className="font-normal text-base-content/60">
          ·{" "}
          {allSelected
            ? `all ${ALL_SPAWN_TOOLS.length} selected`
            : `${selected.length}/${ALL_SPAWN_TOOLS.length} selected`}
        </span>
      </summary>
      <div className={`${SPAWN_SKILLS_CONTAINER} mt-1.5`}>
        {ALL_SPAWN_TOOLS.map((id) => {
          const isSelected = selected.includes(id)
          return (
            <button
              key={id}
              type="button"
              aria-pressed={isSelected}
              data-tool={id}
              data-selected={isSelected}
              onClick={() => onToggle(id)}
              disabled={disabled}
              className={skillChipClass(isSelected)}
            >
              {isSelected ? <span aria-hidden="true">✓</span> : null}
              {id}
            </button>
          )
        })}
      </div>
    </details>
  )
}
