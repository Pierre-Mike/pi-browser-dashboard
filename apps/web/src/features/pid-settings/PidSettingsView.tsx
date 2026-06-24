import { SPAWN_SKILLS_CONTAINER, skillChipClass } from "../dispatch/spawnModalLayout"
import { PID_SETTINGS_REL_PATH, type PidSettingsForm } from "./usePidSettingsForm"

type Props = {
  form: PidSettingsForm
}

// Presentational settings panel: a pure function of the form state, so it can be
// rendered and asserted without a query client. The container (PidSettingsPanel)
// wires the live data in.
export const PidSettingsView = ({ form }: Props) => (
  <div data-testid="pid-settings-panel" className="flex flex-col gap-3 max-w-3xl">
    <div className="flex flex-col gap-0.5">
      <h2 className="text-sm font-semibold text-base-content/80">Project settings</h2>
      <span className="text-[11px] font-mono text-base-content/60">{PID_SETTINGS_REL_PATH}</span>
    </div>

    {form.loading ? (
      <p className="text-xs text-base-content/60">Loading settings…</p>
    ) : form.error ? (
      <p data-testid="pid-settings-error" className="text-xs text-error">
        Couldn't load this project's settings.
      </p>
    ) : (
      <fieldset
        data-testid="pid-settings-default-skills"
        className="flex flex-col gap-1.5 text-xs text-base-content/60"
      >
        <legend className="shrink-0 px-0 font-medium text-base-content/80">
          Default skills{" "}
          <span className="font-normal text-base-content/60">
            · pre-selected when spawning in this project
          </span>
        </legend>
        <div className={SPAWN_SKILLS_CONTAINER}>
          {form.options.map((id) => {
            const selected = form.selected.includes(id)
            return (
              <button
                key={id}
                type="button"
                aria-pressed={selected}
                data-skill={id}
                data-selected={selected}
                onClick={() => form.toggle(id)}
                disabled={form.saving}
                className={skillChipClass(selected)}
              >
                {selected ? <span aria-hidden="true">✓</span> : null}/{id}
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            data-testid="pid-settings-save"
            onClick={form.save}
            disabled={!form.dirty || form.saving}
            className="btn btn-primary btn-xs normal-case shadow-sm shadow-primary/30"
          >
            {form.saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            data-testid="pid-settings-reset"
            onClick={form.reset}
            disabled={!form.dirty || form.saving}
            className="btn btn-ghost btn-xs normal-case"
          >
            Reset
          </button>
          {form.dirty ? (
            <span className="text-[11px] text-warning">Unsaved changes</span>
          ) : (
            <span className="text-[11px] text-base-content/60">Saved</span>
          )}
        </div>
      </fieldset>
    )}
  </div>
)
