import { useState } from "react"
import { useInitMutation } from "./useLibrary"

// Surfaces the skill's `/library install` step in the UI: clone a library repo
// (your fork of the-library) into ~/.claude/skills/library/ so the catalog
// exists. Shown when no library.yaml is found yet.
export const LibrarySetupCard = () => {
  const [repoUrl, setRepoUrl] = useState("")
  const [branch, setBranch] = useState("")
  const m = useInitMutation()

  return (
    <div
      data-testid="library-catalog-missing"
      className="flex flex-col gap-3 text-sm text-base-content/80 py-6 px-5 border border-dashed border-base-300 rounded-lg max-w-xl mx-auto"
    >
      <div>
        <p className="font-medium text-base-content">Set up your library</p>
        <p className="text-xs text-base-content/60 mt-1">
          No <span className="font-mono">library.yaml</span> found. Fork the library repo on GitHub,
          then clone it here to create your catalog. (Equivalent to{" "}
          <span className="font-mono">/library install</span>.)
        </p>
      </div>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-base-content/60">Library repo URL</span>
        <input
          type="text"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          placeholder="https://github.com/you/the-library.git"
          data-testid="library-init-repo"
          className="input input-bordered input-sm font-mono"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-base-content/60">Branch (optional)</span>
        <input
          type="text"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          placeholder="main"
          data-testid="library-init-branch"
          className="input input-bordered input-sm font-mono"
        />
      </label>
      {m.isError ? (
        <div className="text-xs text-error">
          {m.error instanceof Error ? m.error.message : "init failed"}
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="library-init-confirm"
          disabled={m.isPending || repoUrl.trim() === ""}
          onClick={() =>
            m.mutate({
              repoUrl: repoUrl.trim(),
              ...(branch.trim() !== "" ? { branch: branch.trim() } : {}),
            })
          }
          className="btn btn-sm btn-primary"
        >
          {m.isPending ? "Cloning…" : "Initialize library"}
        </button>
        <span className="text-[11px] text-base-content/60">
          Clones into <span className="font-mono">~/.claude/skills/library/</span>
        </span>
      </div>
    </div>
  )
}
