import { useState } from "react"
import type { InstallScope, LibraryEntry } from "../types"
import { useInstallMutation } from "../useLibrary"
import { Modal } from "./Modal"

type Props = {
  open: boolean
  onClose: () => void
  entry: LibraryEntry | null
  projectId: string | null
  initialScope?: InstallScope
}

export const InstallDialog = ({ open, onClose, entry, projectId, initialScope }: Props) => {
  const [scope, setScope] = useState<InstallScope>(initialScope ?? "global")
  const m = useInstallMutation()

  if (!entry) return null
  const canLocal = projectId !== null

  return (
    <Modal
      open={open}
      title={`Install ${entry.name}`}
      onClose={onClose}
      testId="library-install-dialog"
    >
      <p className="text-xs text-slate-500">
        Pull <span className="font-mono">{entry.name}</span> from{" "}
        <span className="font-mono break-all">{entry.source}</span>.
      </p>
      <fieldset className="flex flex-col gap-1">
        <legend className="text-xs font-medium mb-1">Scope</legend>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="radio"
            name="install-scope"
            value="global"
            checked={scope === "global"}
            onChange={() => setScope("global")}
            data-testid="library-install-scope-global"
          />
          Global (<span className="font-mono">~/.claude/...</span>)
        </label>
        <label
          className={`flex items-center gap-2 text-xs ${
            canLocal ? "" : "opacity-50 cursor-not-allowed"
          }`}
        >
          <input
            type="radio"
            name="install-scope"
            value="local"
            checked={scope === "local"}
            onChange={() => setScope("local")}
            disabled={!canLocal}
            data-testid="library-install-scope-local"
          />
          Local (project <span className="font-mono">.claude/...</span>)
          {!canLocal ? (
            <span className="text-[10px] text-slate-400">— open a project to enable</span>
          ) : null}
        </label>
      </fieldset>
      {m.isError ? (
        <div className="text-xs text-rose-600">
          {m.error instanceof Error ? m.error.message : "install failed"}
        </div>
      ) : null}
      {entry.requires && entry.requires.length > 0 ? (
        <p className="text-[11px] text-slate-500">
          Will also install required entries:{" "}
          <span className="font-mono">{entry.requires.join(", ")}</span>
        </p>
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
          data-testid="library-install-confirm"
          disabled={m.isPending}
          onClick={() => {
            m.mutate(
              {
                name: entry.name,
                type: entry.type,
                scope,
                ...(scope === "local" && projectId ? { projectId } : {}),
              },
              { onSuccess: () => onClose() },
            )
          }}
          className="text-xs rounded px-3 py-1 bg-sky-600 text-white hover:bg-sky-500 disabled:opacity-60"
        >
          {m.isPending ? "Installing…" : "Install"}
        </button>
      </div>
    </Modal>
  )
}
