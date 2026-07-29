import {
  describeMachineTheme,
  machineMatchesChoice,
  THEME_FAMILIES,
  THEME_MODE_LABELS,
  THEME_MODES,
  type ThemeMode,
  type ThemeSelection,
} from "../../lib/ui/theme.core"

/**
 * Writing the current choice into the settings file as this machine's default.
 * A separate action rather than a side-effect of picking: the two selects are a
 * per-browser override, and quietly rewriting the machine default every time
 * someone tried a theme would make "override" mean nothing — the file would just
 * hold whatever device changed it last.
 */
export type SaveMachineDefault = {
  readonly saving: boolean
  readonly failed: boolean
  readonly run: () => void
}

type Props = {
  theme: ThemeSelection
  saveDefault: SaveMachineDefault
}

/**
 * The Appearance section, deliberately outside the settings `form` and outside its
 * loading/error branch.
 *
 * The theme is a per-browser override held in localStorage, so the picker must
 * keep working when the settings file cannot be loaded at all — a broken daemon
 * that also left you unable to switch to a readable theme would be the worst
 * possible time to lose the control. `GlobalSettingsView.test.tsx` pins that.
 * Only the *machine default* half needs the daemon, and it fails as a message
 * beside its own button.
 */
export const AppearanceFieldset = ({ theme, saveDefault }: Props) => {
  const isDefault = machineMatchesChoice({ machine: theme.machine, choice: theme.choice })
  return (
    <fieldset data-testid="gs-section-appearance" className="flex flex-col gap-2 text-xs">
      <legend className="px-0 font-medium text-base-content/80">Appearance</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-base-content/80">Theme</span>
          <select
            data-testid="gs-appearance-family"
            className="select select-bordered select-sm"
            value={theme.choice.family}
            onChange={(e) => theme.setFamily(e.target.value)}
          >
            {THEME_FAMILIES.map((family) => (
              <option key={family.id} value={family.id}>
                {family.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-base-content/80">Light / dark</span>
          <select
            data-testid="gs-appearance-mode"
            className="select select-bordered select-sm"
            value={theme.choice.mode}
            onChange={(e) => theme.setMode(e.target.value as ThemeMode)}
          >
            {THEME_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {THEME_MODE_LABELS[mode]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <span data-testid="gs-appearance-hint" className="text-[11px] text-base-content/60">
        Takes effect immediately in this browser, overriding this machine's default (
        <span className="font-mono" data-testid="gs-appearance-machine">
          {describeMachineTheme({ machine: theme.machine })}
        </span>
        ), which is what a browser with no pick of its own shows —{" "}
        <span className="font-mono">{theme.resolved}</span> is active here.
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="gs-appearance-set-default"
          onClick={saveDefault.run}
          disabled={isDefault || saveDefault.saving}
          className="btn btn-xs btn-ghost h-auto min-h-0 border border-base-300 px-2 py-0.5 text-[11px] normal-case text-base-content/80 hover:border-base-300"
        >
          {saveDefault.saving ? "Saving…" : "Set as this machine's default"}
        </button>
        {saveDefault.failed ? (
          <span data-testid="gs-appearance-save-error" className="text-[11px] text-error">
            Couldn't save the machine default.
          </span>
        ) : isDefault ? (
          <span className="text-[11px] text-base-content/60">Already the machine default.</span>
        ) : null}
      </div>
    </fieldset>
  )
}
