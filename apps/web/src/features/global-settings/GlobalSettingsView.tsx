import { FIELD_GROUPS } from "./fields"
import { GLOBAL_SETTINGS_REL_PATH, type GlobalSettingsForm } from "./useGlobalSettingsForm"

type Props = {
  form: GlobalSettingsForm
}

// Presentational global-settings panel: a pure function of the form state, so it
// renders and asserts without a query client. The container (GlobalSettingsPanel)
// wires the live data in.
export const GlobalSettingsView = ({ form }: Props) => (
  <div data-testid="global-settings-panel" className="flex flex-col gap-4 max-w-3xl">
    <div className="flex flex-col gap-0.5">
      <h2 className="text-sm font-semibold text-base-content/80">Global settings</h2>
      <span className="text-[11px] font-mono text-base-content/60">{GLOBAL_SETTINGS_REL_PATH}</span>
    </div>

    {form.loading ? (
      <p className="text-xs text-base-content/60">Loading settings…</p>
    ) : form.error ? (
      <p data-testid="global-settings-error" className="text-xs text-error">
        Couldn't load global settings.
      </p>
    ) : (
      <div className="flex flex-col gap-4">
        {FIELD_GROUPS.map((group) => {
          const sectionVals = form.draft[group.section] as Record<string, string | number>
          return (
            <fieldset
              key={group.section}
              data-testid={`gs-section-${group.section}`}
              className="flex flex-col gap-2 text-xs"
            >
              <legend className="px-0 font-medium text-base-content/80">{group.title}</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {group.fields.map((field) => (
                  <label key={field.key} className="flex flex-col gap-0.5">
                    <span className="text-base-content/80">{field.label}</span>
                    <input
                      data-testid={`gs-${group.section}-${field.key}`}
                      type={field.type === "number" ? "number" : "text"}
                      className="input input-bordered input-sm font-mono"
                      value={String(sectionVals[field.key] ?? "")}
                      disabled={form.saving}
                      onChange={(e) =>
                        form.setField({
                          section: group.section,
                          key: field.key,
                          raw: e.target.value,
                        })
                      }
                    />
                    <span className="text-[11px] text-base-content/60">{field.hint}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )
        })}

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            data-testid="global-settings-save"
            onClick={form.save}
            disabled={!form.dirty || form.saving}
            className="btn btn-primary btn-xs normal-case shadow-sm shadow-primary/30"
          >
            {form.saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            data-testid="global-settings-reset"
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
      </div>
    )}
  </div>
)
