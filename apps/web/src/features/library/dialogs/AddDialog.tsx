import { useState } from "react"
import { LIBRARY_CATEGORIES, type LibraryCategory } from "../types"
import { useAddMutation } from "../useLibrary"
import { Modal } from "./Modal"

type Props = {
  open: boolean
  onClose: () => void
  defaults?: {
    name?: string
    type?: LibraryCategory
    source?: string
  }
}

export const AddDialog = ({ open, onClose, defaults }: Props) => {
  const [name, setName] = useState(defaults?.name ?? "")
  const [type, setType] = useState<LibraryCategory>(defaults?.type ?? "skills")
  const [description, setDescription] = useState("")
  const [source, setSource] = useState(defaults?.source ?? "")
  const [requiresText, setRequiresText] = useState("")
  const m = useAddMutation()

  const submit = () => {
    const requires = requiresText
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    m.mutate(
      {
        name,
        type,
        description,
        source,
        ...(requires.length > 0 ? { requires } : {}),
      },
      {
        onSuccess: () => {
          onClose()
          setName("")
          setDescription("")
          setSource("")
          setRequiresText("")
        },
      },
    )
  }

  return (
    <Modal open={open} title="Register in catalog" onClose={onClose} testId="library-add-dialog">
      <div className="flex flex-col gap-2 text-xs">
        <label className="flex flex-col gap-1">
          <span className="text-slate-500">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid="library-add-name"
            className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-slate-500">Type</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as LibraryCategory)}
            data-testid="library-add-type"
            className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1"
          >
            {LIBRARY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-slate-500">Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            data-testid="library-add-description"
            className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 font-sans"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-slate-500">Source (local path or GitHub blob URL)</span>
          <input
            type="text"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            data-testid="library-add-source"
            className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 font-mono"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-slate-500">
            Requires (comma-separated, e.g. <span className="font-mono">skill:align</span>)
          </span>
          <input
            type="text"
            value={requiresText}
            onChange={(e) => setRequiresText(e.target.value)}
            data-testid="library-add-requires"
            className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 font-mono"
          />
        </label>
      </div>
      {m.isError ? (
        <div className="text-xs text-rose-600">
          {m.error instanceof Error ? m.error.message : "add failed"}
        </div>
      ) : null}
      <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
        <button
          type="button"
          onClick={onClose}
          className="text-xs rounded px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          Cancel
        </button>
        <button
          type="button"
          data-testid="library-add-confirm"
          disabled={m.isPending || name.trim() === "" || source.trim() === ""}
          onClick={submit}
          className="text-xs rounded px-3 py-1 bg-sky-600 text-white hover:bg-sky-500 disabled:opacity-60"
        >
          {m.isPending ? "Adding…" : "Add"}
        </button>
      </div>
    </Modal>
  )
}
