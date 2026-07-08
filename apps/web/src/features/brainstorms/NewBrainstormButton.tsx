import { type FormEvent, useState } from "react"
import { useCreateBrainstorm } from "./useBrainstorms"

type Props = {
  projectId: string
  // Called with the newly created brainstorm's id once the mutation succeeds,
  // so the caller can switch tabs (e.g. setTab(`brainstorm:${id}`)) — a plain
  // callback rather than importing ProjectDashboard's TabKey here.
  onCreated: (id: string) => void
}

/**
 * "+" control rendered at the end of the brainstorm left rail. Clicking it
 * toggles an inline text input for the new board's name — deliberately not a
 * blocking browser-native dialog, which can't be styled or unit-tested.
 * Submitting creates an empty canvas document and hands its id to `onCreated`.
 */
export const NewBrainstormButton = ({ projectId, onCreated }: Props) => {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const create = useCreateBrainstorm(projectId)

  const reset = () => {
    setOpen(false)
    setName("")
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (trimmed === "" || create.isPending) return
    create.mutate(trimmed, {
      onSuccess: (doc) => {
        reset()
        onCreated(doc.id)
      },
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        data-testid="brainstorm-new"
        aria-label="New brainstorm"
        title="New brainstorm"
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
        data-testid="brainstorm-new-input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") reset()
        }}
        onBlur={() => {
          if (name.trim() === "") reset()
        }}
        placeholder="board-name"
        disabled={create.isPending}
        className="w-32 rounded-lg border border-base-300 bg-base-100 px-2 py-1 text-xs outline-none focus:border-primary disabled:opacity-50"
      />
      {create.isError ? (
        <span data-testid="brainstorm-new-error" className="text-[10px] text-error">
          {create.error instanceof Error ? create.error.message : "failed"}
        </span>
      ) : null}
    </form>
  )
}
