import { SPAWN_SKILLS_CONTAINER, skillChipClass } from "./spawnModalLayout"

type Props = {
  // Canonical tool list for the active harness (claude's 40+ built-ins or
  // pi's four) — see HARNESS_SPAWN_TOOLS in spawnTools.ts.
  all: readonly string[]
  selected: readonly string[]
  onToggle: (id: string) => void
  disabled: boolean
}

// The tool-allow fieldset for the spawn modal: one toggle pill per built-in
// tool of the active harness, all selected by default (matching each CLI's own
// default of every tool enabled). Collapsed behind a native <details>
// disclosure since claude's full built-in set runs 40+ entries — most spawns
// never touch this, so it stays out of the way until opened. Split out of
// SpawnModal to keep that component thin, mirroring SpawnSkillPicker.
export const SpawnToolPicker = ({ all, selected, onToggle, disabled }: Props) => {
  const allSelected = selected.length === all.length

  return (
    <details data-testid="spawn-tools" className="text-xs text-base-content/60">
      <summary className="cursor-pointer font-medium text-base-content/80">
        Tools{" "}
        <span className="font-normal text-base-content/60">
          ·{" "}
          {allSelected ? `all ${all.length} selected` : `${selected.length}/${all.length} selected`}
        </span>
      </summary>
      <div className={`${SPAWN_SKILLS_CONTAINER} mt-1.5`}>
        {all.map((id) => {
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
