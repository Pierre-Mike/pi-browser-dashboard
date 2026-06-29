import { File as PierreFile } from "@pierre/diffs/react"
import type {
  ContextMenuAnchorRect,
  ContextMenuItem,
  FileTreeDropResult,
  FileTreeRenameEvent,
  GitStatusEntry,
} from "@pierre/trees"
import { FileTree as PierreFileTree, useFileTree } from "@pierre/trees/react"
import { useQueryClient } from "@tanstack/react-query"
import { useCallback, useMemo, useState } from "react"
import type { FileContent } from "../../lib/types"
import { CODE_FILE_OPTIONS } from "../diffs/diffsOptions"
import { CanvasView } from "./CanvasView"
import { basenameOf, classifyFile, type FileKind } from "./fileKind"
import { createTargetPath, dropMoves, stripSlash } from "./fsOps"
import { MarkdownView } from "./MarkdownView"
import { TreeContextMenu } from "./TreeContextMenu"
import { formatSize, TREE_INITIAL_EXPANSION, TREE_UNSAFE_CSS } from "./treeUtil"
import type { FileResource, FsResult } from "./useProjectFiles"
import {
  fileDownloadUrl,
  fileRawUrl,
  fsCreate,
  fsDelete,
  fsMove,
  useFileContent,
  useFileResource,
} from "./useProjectFiles"

const ICON_FOR_KIND: Record<FileKind, string> = {
  markdown: "📝",
  html: "🌐",
  image: "🖼",
  audio: "🎵",
  video: "🎬",
  pdf: "📕",
  svg: "🖼",
  canvas: "🗺",
  code: "⟨⟩",
  text: "📄",
  binary: "■",
}

const Breadcrumbs = ({ path }: { path: string }) => {
  const parts = path.split("/").filter(Boolean)
  return (
    <nav
      className="flex items-center gap-1 text-[11px] text-base-content/60 truncate"
      data-testid="file-breadcrumbs"
    >
      <span className="text-base-content/60">.</span>
      {parts.map((p, i) => (
        <span key={i} className="flex items-center gap-1 min-w-0">
          <span className="text-base-content/40">/</span>
          <span
            className={
              i === parts.length - 1 ? "text-base-content/80 font-medium truncate" : "truncate"
            }
          >
            {p}
          </span>
        </span>
      ))}
    </nav>
  )
}

const ToolbarButton = ({
  onClick,
  href,
  download,
  children,
  testId,
  title,
}: {
  onClick?: () => void
  href?: string
  // When set, the anchor downloads (with this as the suggested filename)
  // instead of opening in a new tab.
  download?: string
  children: React.ReactNode
  testId?: string
  title?: string
}) => {
  const cls =
    "inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-base-300 hover:bg-base-200 text-base-content/80"
  if (href) {
    return (
      <a
        href={href}
        download={download}
        target={download ? undefined : "_blank"}
        rel="noreferrer noopener"
        className={cls}
        data-testid={testId}
        title={title}
      >
        {children}
      </a>
    )
  }
  return (
    <button type="button" onClick={onClick} className={cls} data-testid={testId} title={title}>
      {children}
    </button>
  )
}

// Syntax-highlighted source preview via @pierre/diffs (Shiki). The library
// infers the language from the file name; we suppress its header because
// FilePreview already renders a toolbar. Theme follows the OS colour scheme.
const CodeView = ({ name, content }: { name: string; content: string }) => (
  <div
    data-testid="file-code"
    className="text-[12px] leading-snug bg-base-100 overflow-auto h-full"
  >
    <PierreFile file={{ name, contents: content }} options={CODE_FILE_OPTIONS} />
  </div>
)

// Pre-existing kind switch (10 branches); pulled into audit scope by the
// tree-mutation wiring added to this file — refactoring it is out of scope here.
// fallow-ignore-next-line complexity
const FileBody = ({
  resource,
  file,
  kind,
}: {
  resource: FileResource
  file: FileContent
  kind: FileKind
}) => {
  const rawUrl = fileRawUrl(resource, file.path)
  switch (kind) {
    case "markdown":
      return (
        <div data-testid="file-body-markdown" className="overflow-auto h-full bg-base-100">
          <MarkdownView text={file.content} />
        </div>
      )
    case "html":
      return (
        <iframe
          data-testid="file-body-html"
          title={file.path}
          src={rawUrl}
          sandbox="allow-same-origin"
          className="w-full h-full border-0 bg-base-100"
        />
      )
    case "image":
    case "svg":
      return (
        <div
          data-testid="file-body-image"
          className="flex items-center justify-center h-full overflow-auto bg-base-200"
        >
          <img src={rawUrl} alt={file.path} className="max-w-full max-h-full object-contain" />
        </div>
      )
    case "audio":
      return (
        <div
          data-testid="file-body-audio"
          className="flex flex-col items-center justify-center gap-3 h-full p-6 bg-gradient-to-b from-base-100 to-base-200"
        >
          <div className="text-5xl">🎵</div>
          <div className="text-sm font-medium text-base-content/80 break-all text-center">
            {basenameOf(file.path)}
          </div>
          {/* biome-ignore lint/a11y/useMediaCaption: user-supplied media; no captions available */}
          <audio controls src={rawUrl} className="w-full max-w-md">
            audio not supported
          </audio>
        </div>
      )
    case "video":
      return (
        <div
          data-testid="file-body-video"
          className="flex items-center justify-center h-full bg-neutral"
        >
          {/* biome-ignore lint/a11y/useMediaCaption: user-supplied media; no captions available */}
          <video controls src={rawUrl} className="max-w-full max-h-full">
            video not supported
          </video>
        </div>
      )
    case "pdf":
      return (
        <iframe
          data-testid="file-body-pdf"
          title={file.path}
          src={rawUrl}
          className="w-full h-full border-0 bg-base-100"
        />
      )
    case "canvas":
      return <CanvasView raw={file.content} />
    case "binary":
      return (
        <div
          data-testid="file-body-binary"
          className="flex flex-col items-center justify-center gap-2 h-full text-base-content/60"
        >
          <div className="text-4xl">■</div>
          <div className="text-xs">Binary file — no inline preview</div>
          <a
            href={rawUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="text-xs text-primary hover:underline"
          >
            Download {basenameOf(file.path)}
          </a>
        </div>
      )
    case "code":
    case "text":
      return <CodeView name={file.path} content={file.content} />
  }
}

// Pre-existing load/error/preview branching; in audit scope only because this
// file gained the tree-mutation wiring. Out of scope to refactor here.
// fallow-ignore-next-line complexity
const FilePreview = ({ resource, path }: { resource: FileResource; path: string }) => {
  const q = useFileContent(resource, path)
  const [copied, setCopied] = useState(false)

  const copyPath = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(path)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      // clipboard blocked — silent fail
    }
  }

  if (q.isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-base-content/60">
        Loading…
      </div>
    )
  }
  if (q.isError) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-error px-4 text-center">
        {q.error instanceof Error ? q.error.message : "failed to load"}
      </div>
    )
  }
  const f = q.data
  if (!f) return null
  const kind: FileKind = classifyFile(f.path, f.isBinary)
  const rawUrl = fileRawUrl(resource, f.path)
  const downloadUrl = fileDownloadUrl(resource, f.path)
  const fileName = basenameOf(f.path)
  return (
    <div data-testid="file-preview" className="flex flex-col h-full min-h-0 bg-base-100">
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-base-300 bg-base-100/80 backdrop-blur">
        <div className="min-w-0 flex flex-col gap-0.5">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-base leading-none">{ICON_FOR_KIND[kind]}</span>
            <span data-testid="file-name" className="font-mono text-sm truncate text-base-content">
              {basenameOf(f.path)}
            </span>
            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-base-300 text-base-content/80">
              {kind}
            </span>
          </div>
          <Breadcrumbs path={f.path} />
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] text-base-content/60 tabular-nums mr-1">
            {formatSize(f.size)}
          </span>
          <ToolbarButton
            href={downloadUrl}
            download={fileName}
            testId="file-download"
            title={`Download ${fileName}`}
          >
            ↓ Download
          </ToolbarButton>
          <ToolbarButton onClick={copyPath} testId="file-copy-path" title="Copy path">
            {copied ? "Copied" : "Copy path"}
          </ToolbarButton>
          <ToolbarButton href={rawUrl} testId="file-open-raw" title="Open raw file in a new tab">
            Open raw ↗
          </ToolbarButton>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <FileBody resource={resource} file={f} kind={kind} />
      </div>
    </div>
  )
}

// Friendly text for a daemon FileError, shown inline in the menu (create /
// delete) or in the sidebar banner (rename / drag-move).
const FS_ERROR_TEXT: Record<string, string> = {
  exists: "a file with that name already exists",
  forbidden: "not allowed",
  not_found: "not found — it may have moved",
  not_a_file: "directory isn’t empty",
}
const fsErrMessage = (verb: string, r: Extract<FsResult, { ok: false }>): string =>
  `Couldn’t ${verb}: ${FS_ERROR_TEXT[r.error] ?? r.error}`

type MutationCallbacks = {
  onMutationSuccess: () => void
  onMutationError: (message: string) => void
}

// The tree model is built once from the loaded path list (@pierre/trees'
// useFileTree ignores later option changes), so this pane is mounted only after
// the listing resolves and is keyed by resource id + a reload nonce — a failed
// mutation bumps the nonce to remount and discard the optimistic model edit.
const TreePane = ({
  resource,
  paths,
  gitStatus,
  selected,
  onSelect,
  onMutationSuccess,
  onMutationError,
}: {
  resource: FileResource
  paths: readonly string[]
  gitStatus: readonly GitStatusEntry[] | undefined
  selected: string | null
  onSelect: (path: string) => void
} & MutationCallbacks) => {
  const fileSet = useMemo(() => new Set(paths), [paths])
  const [menu, setMenu] = useState<{
    item: ContextMenuItem
    rect: ContextMenuAnchorRect
  } | null>(null)

  // Persistence for the lib-driven flows. The lib has already applied the model
  // edit by the time these fire, so success just refreshes the cache and a
  // failure asks the parent to reconcile (remount from disk truth).
  const handleRename = useCallback(
    async (event: FileTreeRenameEvent): Promise<void> => {
      const r = await fsMove(resource, {
        from: stripSlash(event.sourcePath),
        to: stripSlash(event.destinationPath),
      })
      if (r.ok) onMutationSuccess()
      else onMutationError(fsErrMessage("rename", r))
    },
    [resource, onMutationSuccess, onMutationError],
  )

  const handleDrop = useCallback(
    async (result: FileTreeDropResult): Promise<void> => {
      const moves = dropMoves(result.draggedPaths, result.target)
      for (const m of moves) {
        const r = await fsMove(resource, { from: m.from, to: m.to })
        if (!r.ok) {
          onMutationError(fsErrMessage("move", r))
          return
        }
      }
      onMutationSuccess()
    },
    [resource, onMutationSuccess, onMutationError],
  )

  const { model } = useFileTree({
    paths,
    gitStatus,
    initialExpansion: TREE_INITIAL_EXPANSION,
    search: true,
    unsafeCSS: TREE_UNSAFE_CSS,
    initialSelectedPaths: selected ? [selected] : undefined,
    onSelectionChange: (selectedPaths) => {
      // Directory rows fire selection too; only file paths drive the preview.
      const file = selectedPaths.find((p) => fileSet.has(p))
      if (file) onSelect(file)
    },
    renaming: { onRename: handleRename },
    dragAndDrop: { onDropComplete: handleDrop },
    composition: {
      contextMenu: {
        enabled: true,
        triggerMode: "both",
        onOpen: (item, ctx) => setMenu({ item, rect: ctx.anchorRect }),
        onClose: () => setMenu(null),
      },
    },
  })

  // Menu-driven flows: WE drive the model edit, only after the daemon confirms.
  // Reflect a confirmed create in the tree model (dirs use the lib's trailing-
  // slash canonical path) and open the new file in the preview.
  const commitCreate = (path: string, kind: "file" | "directory"): void => {
    model.add(kind === "directory" ? `${path}/` : path)
    if (kind === "file") onSelect(path)
    onMutationSuccess()
  }

  const handleCreate = async (kind: "file" | "directory", name: string): Promise<string | null> => {
    if (!menu) return null
    const path = createTargetPath(menu.item, name)
    const r = await fsCreate(resource, { path, kind })
    if (!r.ok) return fsErrMessage("create", r)
    commitCreate(path, kind)
    return null
  }

  const handleDelete = async (): Promise<string | null> => {
    if (!menu) return null
    const recursive = menu.item.kind === "directory"
    const r = await fsDelete(resource, { path: stripSlash(menu.item.path), recursive })
    if (!r.ok) return fsErrMessage("delete", r)
    model.remove(menu.item.path, recursive ? { recursive: true } : undefined)
    onMutationSuccess()
    return null
  }

  return (
    <>
      <PierreFileTree model={model} className="text-xs" style={{ height: "100%" }} />
      {menu ? (
        <TreeContextMenu
          item={menu.item}
          rect={menu.rect}
          onClose={() => setMenu(null)}
          onCreate={handleCreate}
          onRename={() => model.startRenaming(menu.item.path)}
          onDelete={handleDelete}
        />
      ) : null}
    </>
  )
}

type SidebarProps = {
  resource: FileResource
  tree: ReturnType<typeof useFileResource>
  selected: string | null
  onSelect: (path: string) => void
}

const errorMessage = (e: unknown, fallback: string): string =>
  e instanceof Error ? e.message : fallback

const treePaths = (tree: ReturnType<typeof useFileResource>): readonly string[] =>
  tree.data?.paths ?? []

const treeGitStatus = (
  tree: ReturnType<typeof useFileResource>,
): readonly GitStatusEntry[] | undefined => tree.data?.gitStatus

// Loading / error / tree states. The TreePane is keyed by resource id + a
// reload nonce so a resource switch — or a failed mutation — rebuilds the
// (once-built) @pierre/trees model from the freshly-fetched listing.
const TreeBody = ({ resource, tree, selected, onSelect }: SidebarProps) => {
  const queryClient = useQueryClient()
  const [reloadNonce, setReloadNonce] = useState(0)
  const [banner, setBanner] = useState<string | null>(null)
  const { kind, id } = resource

  const onMutationSuccess = useCallback(() => {
    setBanner(null)
    void queryClient.invalidateQueries({ queryKey: ["file-tree", kind, id] })
  }, [queryClient, kind, id])

  const onMutationError = useCallback(
    (message: string) => {
      setBanner(message)
      void queryClient.invalidateQueries({ queryKey: ["file-tree", kind, id] }).then(() => {
        setReloadNonce((n) => n + 1)
      })
    },
    [queryClient, kind, id],
  )

  if (tree.isLoading) {
    return <div className="text-[11px] text-base-content/60 italic px-3 py-2">loading…</div>
  }
  if (tree.isError) {
    return (
      <div className="text-[11px] text-error px-3 py-2">
        {errorMessage(tree.error, "failed to load tree")}
      </div>
    )
  }
  return (
    <>
      {banner ? (
        <div
          data-testid="file-tree-error"
          className="sticky top-0 z-10 flex items-center justify-between gap-2 text-[11px] text-error bg-error/15 px-3 py-1"
        >
          <span className="truncate">{banner}</span>
          <button
            type="button"
            className="shrink-0 text-error/80 hover:text-error"
            onClick={() => setBanner(null)}
          >
            ✕
          </button>
        </div>
      ) : null}
      <TreePane
        key={`${resource.id}:${reloadNonce}`}
        resource={resource}
        paths={treePaths(tree)}
        gitStatus={treeGitStatus(tree)}
        selected={selected}
        onSelect={onSelect}
        onMutationSuccess={onMutationSuccess}
        onMutationError={onMutationError}
      />
    </>
  )
}

// Left column: the tree plus its truncation chrome.
const FileTreeSidebar = (props: SidebarProps) => (
  <aside className="flex flex-col min-h-0 border-r border-base-300 bg-base-100/60">
    <div data-testid="file-tree-scroll" className="flex-1 min-h-0 overflow-auto">
      <TreeBody {...props} />
    </div>
    {props.tree.data?.truncated ? (
      <div className="text-[10px] text-warning px-3 py-1 border-t border-base-300">
        listing truncated — some files hidden
      </div>
    ) : null}
  </aside>
)

const EmptyPreview = () => (
  <div className="flex flex-col items-center justify-center gap-2 h-full text-base-content/60 text-center px-6">
    <div className="text-4xl">📂</div>
    <div className="text-sm font-medium">Pick a file to preview</div>
    <div className="text-xs text-base-content/60 max-w-sm">
      Markdown renders as Markdown · HTML opens in a sandboxed frame · images, PDFs, audio and video
      play inline.
    </div>
  </div>
)

export const FileTree = ({ resource }: { resource: FileResource }) => {
  const tree = useFileResource(resource)
  const [selected, setSelected] = useState<string | null>(null)
  const handleSelect = useCallback((path: string) => setSelected(path), [])

  return (
    <div
      data-testid="project-file-tree"
      className="grid grid-cols-1 md:grid-cols-[minmax(240px,320px)_1fr] gap-0 border border-base-300 rounded-xl overflow-hidden bg-base-100/60 shadow-sm flex-1 min-h-0"
    >
      <FileTreeSidebar
        resource={resource}
        tree={tree}
        selected={selected}
        onSelect={handleSelect}
      />
      <section className="min-h-0 overflow-hidden">
        {selected ? <FilePreview resource={resource} path={selected} /> : <EmptyPreview />}
      </section>
    </div>
  )
}
