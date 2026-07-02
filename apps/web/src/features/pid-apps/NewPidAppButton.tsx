import { type FormEvent, useState } from "react"
import { useCreatePidApp } from "./usePidApps"

type Props = {
  projectId: string
  // Called with the newly created app's id once the mutation succeeds, so the
  // caller can switch tabs (e.g. setTab(`pidapp:${appId}`)) — kept as a plain
  // callback rather than importing ProjectDashboard's TabKey here.
  onCreated: (appId: string) => void
}

/**
 * "+" control rendered after the project tab list. Clicking it toggles an
 * inline text input for the new app's name — deliberately not a blocking
 * browser-native dialog, which can't be styled or unit-tested. Submitting
 * creates a starter pid-app and hands its id to `onCreated`.
 */
export const NewPidAppButton = ({ projectId, onCreated }: Props) => {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const create = useCreatePidApp(projectId)

  const reset = () => {
    setOpen(false)
    setName("")
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (trimmed === "" || create.isPending) return
    create.mutate(trimmed, {
      onSuccess: (app) => {
        reset()
        onCreated(app.id)
      },
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        data-testid="pid-app-new"
        aria-label="New pid-app"
        title="New pid-app"
        onClick={() => setOpen(true)}
        className="shrink-0 inline-flex items-center justify-center rounded-lg px-2.5 py-1.5 text-xs font-medium text-base-content/60 transition-colors hover:bg-base-300/70 hover:text-base-content"
      >
        +
      </button>
    )
  }

  return (
    <form onSubmit={onSubmit} className="flex shrink-0 items-center gap-1">
      <input
        // biome-ignore lint/a11y/noAutofocus: opens on explicit user click, not on page load
        autoFocus
        data-testid="pid-app-new-input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") reset()
        }}
        onBlur={() => {
          if (name.trim() === "") reset()
        }}
        placeholder="app-name"
        disabled={create.isPending}
        className="w-24 rounded-lg border border-base-300 bg-base-100 px-2 py-1 text-xs outline-none focus:border-primary disabled:opacity-50"
      />
      {create.isError ? (
        <span data-testid="pid-app-new-error" className="text-[10px] text-error">
          {create.error instanceof Error ? create.error.message : "failed"}
        </span>
      ) : null}
    </form>
  )
}
