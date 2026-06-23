import { File as PierreFile } from "@pierre/diffs/react"
import type { GitStatusEntry } from "@pierre/trees"
import { FileTree as PierreFileTree, useFileTree } from "@pierre/trees/react"
import { useCallback, useMemo, useState } from "react"
import type { FileContent } from "../../lib/types"
import { CODE_FILE_OPTIONS } from "../diffs/diffsOptions"
import { CanvasView } from "./CanvasView"
import { basenameOf, classifyFile, type FileKind } from "./fileKind"
import { MarkdownView } from "./MarkdownView"
import { formatSize, TREE_INITIAL_EXPANSION, TREE_UNSAFE_CSS } from "./treeUtil"
import type { FileResource } from "./useProjectFiles"
import { fileDownloadUrl, fileRawUrl, useFileContent, useFileResource } from "./useProjectFiles"

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
      className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 truncate"
      data-testid="file-breadcrumbs"
    >
      <span className="text-slate-400">.</span>
      {parts.map((p, i) => (
        <span key={i} className="flex items-center gap-1 min-w-0">
          <span className="text-slate-300 dark:text-slate-600">/</span>
          <span
            className={
              i === parts.length - 1
                ? "text-slate-700 dark:text-slate-200 font-medium truncate"
                : "truncate"
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
    "inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
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
    className="text-[12px] leading-snug bg-slate-50 dark:bg-slate-950/60 overflow-auto h-full"
  >
    <PierreFile file={{ name, contents: content }} options={CODE_FILE_OPTIONS} />
  </div>
)

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
        <div
          data-testid="file-body-markdown"
          className="overflow-auto h-full bg-white dark:bg-slate-950"
        >
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
          className="w-full h-full border-0 bg-white"
        />
      )
    case "image":
    case "svg":
      return (
        <div
          data-testid="file-body-image"
          className="flex items-center justify-center h-full overflow-auto bg-[conic-gradient(at_top_left,_#f8fafc,_#e2e8f0)] dark:bg-[conic-gradient(at_top_left,_#0f172a,_#1e293b)]"
        >
          <img src={rawUrl} alt={file.path} className="max-w-full max-h-full object-contain" />
        </div>
      )
    case "audio":
      return (
        <div
          data-testid="file-body-audio"
          className="flex flex-col items-center justify-center gap-3 h-full p-6 bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-950"
        >
          <div className="text-5xl">🎵</div>
          <div className="text-sm font-medium text-slate-700 dark:text-slate-200 break-all text-center">
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
          className="flex items-center justify-center h-full bg-black"
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
          className="w-full h-full border-0 bg-white"
        />
      )
    case "canvas":
      return <CanvasView raw={file.content} />
    case "binary":
      return (
        <div
          data-testid="file-body-binary"
          className="flex flex-col items-center justify-center gap-2 h-full text-slate-500"
        >
          <div className="text-4xl">■</div>
          <div className="text-xs">Binary file — no inline preview</div>
          <a
            href={rawUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="text-xs text-sky-600 dark:text-sky-400 hover:underline"
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
      <div className="flex items-center justify-center h-full text-xs text-slate-500">Loading…</div>
    )
  }
  if (q.isError) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-rose-500 px-4 text-center">
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
    <div
      data-testid="file-preview"
      className="flex flex-col h-full min-h-0 bg-white dark:bg-slate-950"
    >
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/70 backdrop-blur">
        <div className="min-w-0 flex flex-col gap-0.5">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-base leading-none">{ICON_FOR_KIND[kind]}</span>
            <span
              data-testid="file-name"
              className="font-mono text-sm truncate text-slate-800 dark:text-slate-100"
            >
              {basenameOf(f.path)}
            </span>
            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              {kind}
            </span>
          </div>
          <Breadcrumbs path={f.path} />
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] text-slate-400 tabular-nums mr-1">{formatSize(f.size)}</span>
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

// The tree model is built once from the loaded path list (@pierre/trees'
// useFileTree ignores later option changes), so this pane is mounted only after
// the listing resolves and is keyed by project id to rebuild on project switch.
const TreePane = ({
  paths,
  gitStatus,
  selected,
  onSelect,
}: {
  paths: readonly string[]
  gitStatus: readonly GitStatusEntry[] | undefined
  selected: string | null
  onSelect: (path: string) => void
}) => {
  const fileSet = useMemo(() => new Set(paths), [paths])
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
  })
  return <PierreFileTree model={model} className="text-xs" style={{ height: "100%" }} />
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

// Loading / error / tree states. The TreePane is keyed by resource id so a
// resource switch rebuilds the (once-built) @pierre/trees model.
const TreeBody = ({ resource, tree, selected, onSelect }: SidebarProps) => {
  if (tree.isLoading) {
    return <div className="text-[11px] text-slate-400 italic px-3 py-2">loading…</div>
  }
  if (tree.isError) {
    return (
      <div className="text-[11px] text-rose-500 px-3 py-2">
        {errorMessage(tree.error, "failed to load tree")}
      </div>
    )
  }
  return (
    <TreePane
      key={resource.id}
      paths={treePaths(tree)}
      gitStatus={treeGitStatus(tree)}
      selected={selected}
      onSelect={onSelect}
    />
  )
}

// Left column: the tree plus its truncation chrome.
const FileTreeSidebar = (props: SidebarProps) => (
  <aside className="flex flex-col min-h-0 border-r border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40">
    <div data-testid="file-tree-scroll" className="flex-1 min-h-0 overflow-auto">
      <TreeBody {...props} />
    </div>
    {props.tree.data?.truncated ? (
      <div className="text-[10px] text-amber-600 dark:text-amber-300 px-3 py-1 border-t border-slate-200 dark:border-slate-800">
        listing truncated — some files hidden
      </div>
    ) : null}
  </aside>
)

const EmptyPreview = () => (
  <div className="flex flex-col items-center justify-center gap-2 h-full text-slate-500 text-center px-6">
    <div className="text-4xl">📂</div>
    <div className="text-sm font-medium">Pick a file to preview</div>
    <div className="text-xs text-slate-400 max-w-sm">
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
      className="grid grid-cols-1 md:grid-cols-[minmax(240px,320px)_1fr] gap-0 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white/60 dark:bg-slate-900/60 shadow-sm flex-1 min-h-0"
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
