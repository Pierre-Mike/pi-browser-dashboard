import { useState } from "react"
import type { InstallScope, LibraryEntry, StatusByScope } from "../types"
import { useRemoveMutation } from "../useLibrary"
import { Modal } from "./Modal"

type Props = {
  open: boolean
  onClose: () => void
  entry: LibraryEntry | null
  status: StatusByScope | undefined
  projectId: string | null
}

export const RemoveDialog = ({ open, onClose, entry, status, projectId }: Props) => {
  const [deleteLocal, setDeleteLocal] = useState(false)
  const [scope, setScope] = useState<InstallScope>(
    status?.global === "installed" ? "global" : "local",
  )
  const m = useRemoveMutation()
  if (!entry) return null

  return (
    <Modal
      open={open}
      title={`Remove ${entry.name}`}
      onClose={onClose}
      testId="library-remove-dialog"
    >
      <p className="text-xs text-base-content/60">
        Remove{" "}
        <span className="font-mono">
          {entry.type}:{entry.name}
        </span>{" "}
        from the catalog. This commits to the library repo immediately.
      </p>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={deleteLocal}
          onChange={(e) => setDeleteLocal(e.target.checked)}
          data-testid="library-remove-delete-local"
        />
        Also delete the local install directory
      </label>
      {deleteLocal ? (
        <fieldset className="flex flex-col gap-1 pl-5">
          <legend className="text-[11px] font-medium text-base-content/60">
            From which scope?
          </legend>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="radio"
              name="remove-scope"
              checked={scope === "global"}
              onChange={() => setScope("global")}
              disabled={status?.global !== "installed"}
            />
            Global {status?.global === "installed" ? "✓" : ""}
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="radio"
              name="remove-scope"
              checked={scope === "local"}
              onChange={() => setScope("local")}
              disabled={status?.local !== "installed" || projectId === null}
            />
            Local {status?.local === "installed" ? "✓" : ""}
          </label>
        </fieldset>
      ) : null}
      {m.isError ? (
        <div className="text-xs text-error">
          {m.error instanceof Error ? m.error.message : "remove failed"}
        </div>
      ) : null}
      <div className="flex items-center justify-end gap-2 pt-2 border-t border-base-300">
        <button
          type="button"
          onClick={onClose}
          className="text-xs rounded px-2 py-1 hover:bg-base-200"
        >
          Cancel
        </button>
        <button
          type="button"
          data-testid="library-remove-confirm"
          disabled={m.isPending}
          onClick={() => {
            m.mutate(
              {
                name: entry.name,
                type: entry.type,
                scope,
                deleteLocal,
                ...(scope === "local" && projectId ? { projectId } : {}),
              },
              { onSuccess: () => onClose() },
            )
          }}
          className="text-xs rounded px-3 py-1 bg-error text-white hover:bg-error disabled:opacity-60"
        >
          {m.isPending ? "Removing…" : "Remove"}
        </button>
      </div>
    </Modal>
  )
}
