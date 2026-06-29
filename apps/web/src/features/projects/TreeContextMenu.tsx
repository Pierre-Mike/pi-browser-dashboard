import type { ContextMenuAnchorRect } from "@pierre/trees"
import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { fsNameError } from "./fsOps"

export type TreeMenuItem = {
  readonly path: string
  readonly kind: "file" | "directory"
  readonly name: string
}

export type TreeContextMenuProps = {
  readonly item: TreeMenuItem
  readonly rect: ContextMenuAnchorRect
  readonly onClose: () => void
  // Each async action resolves to an error message (kept inline, menu stays
  // open) or null on success (menu closes).
  readonly onCreate: (kind: "file" | "directory", name: string) => Promise<string | null>
  readonly onRename: () => void
  readonly onDelete: () => Promise<string | null>
}

type Mode =
  | { readonly t: "menu" }
  | { readonly t: "create"; readonly kind: "file" | "directory" }
  | { readonly t: "confirm-delete" }

const MENU_WIDTH = 192

// Clamp the anchor so the menu never overflows the viewport edge.
const clamp = (rect: ContextMenuAnchorRect): { top: number; left: number } => ({
  top: Math.min(rect.bottom, window.innerHeight - 8),
  left: Math.min(rect.left, window.innerWidth - MENU_WIDTH - 8),
})

const MenuButton = ({
  onClick,
  children,
  tone,
  testId,
}: {
  onClick: () => void
  children: React.ReactNode
  tone?: "danger"
  testId?: string
}) => (
  <button
    type="button"
    role="menuitem"
    onClick={onClick}
    data-testid={testId}
    className={`w-full text-left px-3 py-1.5 text-xs rounded hover:bg-base-200 ${
      tone === "danger" ? "text-error" : "text-base-content"
    }`}
  >
    {children}
  </button>
)

// Root menu: the four actions. Create/Delete switch the parent into a sub-mode;
// Rename hands straight back to the lib's inline editor.
const MenuList = ({
  onNew,
  onRename,
  onDelete,
}: {
  onNew: (kind: "file" | "directory") => void
  onRename: () => void
  onDelete: () => void
}) => (
  <div role="menu" className="flex flex-col">
    <MenuButton onClick={() => onNew("file")} testId="ctx-new-file">
      New File
    </MenuButton>
    <MenuButton onClick={() => onNew("directory")} testId="ctx-new-folder">
      New Folder
    </MenuButton>
    <MenuButton onClick={onRename} testId="ctx-rename">
      Rename…
    </MenuButton>
    <MenuButton tone="danger" onClick={onDelete} testId="ctx-delete">
      Delete
    </MenuButton>
  </div>
)

// Inline name entry for a new file/folder. Owns its own input/busy/error state;
// reports the chosen name up via onSubmit, which returns an error or null.
const CreateForm = ({
  kind,
  onCancel,
  onSubmit,
}: {
  kind: "file" | "directory"
  onCancel: () => void
  onSubmit: (name: string) => Promise<string | null>
}) => {
  const inputRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const submit = async (): Promise<void> => {
    const invalid = fsNameError(name)
    if (invalid) {
      setError(invalid)
      return
    }
    setBusy(true)
    const failure = await onSubmit(name.trim())
    setBusy(false)
    if (failure) setError(failure)
  }

  return (
    <form
      className="px-2 py-1.5 flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <div className="text-[11px] text-base-content/80">
        New {kind === "directory" ? "folder" : "file"}
      </div>
      <input
        ref={inputRef}
        value={name}
        disabled={busy}
        onChange={(e) => {
          setName(e.target.value)
          setError(null)
        }}
        placeholder={kind === "directory" ? "folder name" : "file name"}
        className="input input-bordered input-xs w-full"
        data-testid="ctx-name-input"
      />
      {error ? <div className="text-[10px] text-error">{error}</div> : null}
      <div className="flex justify-end gap-1">
        <button type="button" className="btn btn-ghost btn-xs" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary btn-xs" disabled={busy}>
          Create
        </button>
      </div>
    </form>
  )
}

// Two-step delete guard. Owns its own busy/error state.
const DeleteConfirm = ({
  item,
  onCancel,
  onConfirm,
}: {
  item: TreeMenuItem
  onCancel: () => void
  onConfirm: () => Promise<string | null>
}) => {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const confirm = async (): Promise<void> => {
    setBusy(true)
    const failure = await onConfirm()
    setBusy(false)
    if (failure) setError(failure)
  }

  return (
    <div className="px-3 py-2 flex flex-col gap-2">
      <div className="text-[11px] text-base-content/80">
        Delete <span className="font-medium break-all">{item.name}</span>
        {item.kind === "directory" ? " and its contents?" : "?"}
      </div>
      {error ? <div className="text-[10px] text-error">{error}</div> : null}
      <div className="flex justify-end gap-1">
        <button type="button" className="btn btn-ghost btn-xs" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-error btn-xs"
          disabled={busy}
          onClick={() => void confirm()}
          data-testid="ctx-confirm-delete"
        >
          Delete
        </button>
      </div>
    </div>
  )
}

// Render the body for the active mode. Kept as a tiny dispatcher so the menu
// shell itself stays branch-light.
const MenuBody = ({
  mode,
  item,
  setMode,
  onClose,
  onCreate,
  onRename,
  onDelete,
}: {
  mode: Mode
  setMode: (m: Mode) => void
} & Pick<TreeContextMenuProps, "item" | "onClose" | "onCreate" | "onRename" | "onDelete">) => {
  if (mode.t === "create") {
    return (
      <CreateForm
        kind={mode.kind}
        onCancel={() => setMode({ t: "menu" })}
        onSubmit={async (name) => {
          const failure = await onCreate(mode.kind, name)
          if (!failure) onClose()
          return failure
        }}
      />
    )
  }
  if (mode.t === "confirm-delete") {
    return (
      <DeleteConfirm
        item={item}
        onCancel={() => setMode({ t: "menu" })}
        onConfirm={async () => {
          const failure = await onDelete()
          if (!failure) onClose()
          return failure
        }}
      />
    )
  }
  return (
    <MenuList
      onNew={(kind) => setMode({ t: "create", kind })}
      onRename={() => {
        onRename()
        onClose()
      }}
      onDelete={() => setMode({ t: "confirm-delete" })}
    />
  )
}

export const TreeContextMenu = (props: TreeContextMenuProps) => {
  const { item, rect, onClose } = props
  const ref = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<Mode>({ t: "menu" })

  // Close on outside-click and Escape (the menu lives in a body portal, so the
  // tree's own dismissal can't see it).
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [onClose])

  const { top, left } = clamp(rect)

  return createPortal(
    <div
      ref={ref}
      data-file-tree-context-menu-root="true"
      data-testid="tree-context-menu"
      className="fixed z-50 bg-base-100 border border-base-300 rounded-box shadow-lg py-1 text-base-content"
      style={{ top, left, width: MENU_WIDTH }}
    >
      <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-base-content/60 truncate">
        {item.name}
      </div>
      <MenuBody mode={mode} setMode={setMode} {...props} />
    </div>,
    document.body,
  )
}
