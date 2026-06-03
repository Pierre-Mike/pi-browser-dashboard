import { useMemo, useState } from "react"
import type { FileContent, FileEntry } from "../../lib/types"
import { CanvasView } from "./CanvasView"
import { basenameOf, classifyFile, type FileKind } from "./fileKind"
import { MarkdownView } from "./MarkdownView"
import { formatSize, joinPath } from "./treeUtil"
import { projectRawUrl, useProjectDir, useProjectFile } from "./useProjectFiles"

type Props = {
  projectId: string
  onPick?: (path: string) => void
}

type NodeProps = {
  projectId: string
  path: string
  name: string
  depth: number
  selected: string | null
  filter: string
  onPick: (path: string) => void
}

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

const iconForEntry = (e: FileEntry): string => {
  if (e.type === "dir") return "📁"
  if (e.type === "symlink") return "🔗"
  return ICON_FOR_KIND[classifyFile(e.name, false)]
}

const matchesFilter = (name: string, filter: string): boolean => {
  if (!filter) return true
  return name.toLowerCase().includes(filter.toLowerCase())
}

const DirNode = ({ projectId, path, name, depth, selected, filter, onPick }: NodeProps) => {
  const [open, setOpen] = useState(depth === 0 || filter !== "")
  const q = useProjectDir({ projectId, path, enabled: open })
  const indent = depth * 12
  return (
    <div>
      <button
        type="button"
        data-testid={`tree-dir-${path || "ROOT"}`}
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 text-left text-xs py-1 px-1 hover:bg-slate-100 dark:hover:bg-slate-800/50 rounded text-slate-700 dark:text-slate-200"
        style={{ paddingLeft: indent + 4 }}
      >
        <span className="font-mono text-slate-400 w-3">{open ? "▾" : "▸"}</span>
        <span className="text-base leading-none">📁</span>
        <span className="truncate font-medium">{name || "/"}</span>
      </button>
      {open ? (
        <div>
          {q.isLoading ? (
            <div className="text-[10px] text-slate-400 italic" style={{ paddingLeft: indent + 20 }}>
              loading…
            </div>
          ) : q.isError ? (
            <div className="text-[10px] text-rose-500" style={{ paddingLeft: indent + 20 }}>
              {q.error instanceof Error ? q.error.message : "failed"}
            </div>
          ) : (
            (q.data?.entries ?? [])
              .filter((e) => e.type === "dir" || matchesFilter(e.name, filter))
              .map((e) => (
                <EntryRow
                  key={e.name}
                  projectId={projectId}
                  parent={path}
                  entry={e}
                  depth={depth + 1}
                  selected={selected}
                  filter={filter}
                  onPick={onPick}
                />
              ))
          )}
        </div>
      ) : null}
    </div>
  )
}

const EntryRow = ({
  projectId,
  parent,
  entry,
  depth,
  selected,
  filter,
  onPick,
}: {
  projectId: string
  parent: string
  entry: FileEntry
  depth: number
  selected: string | null
  filter: string
  onPick: (path: string) => void
}) => {
  const full = joinPath(parent, entry.name)
  if (entry.type === "dir") {
    return (
      <DirNode
        projectId={projectId}
        path={full}
        name={entry.name}
        depth={depth}
        selected={selected}
        filter={filter}
        onPick={onPick}
      />
    )
  }
  const isSelected = selected === full
  const indent = depth * 12
  return (
    <button
      type="button"
      data-testid={`tree-file-${full}`}
      onClick={() => onPick(full)}
      className={`w-full flex items-center justify-between gap-2 text-left text-xs py-1 px-1 rounded transition-colors ${
        isSelected
          ? "bg-sky-100 dark:bg-sky-900/40 text-sky-900 dark:text-sky-100 ring-1 ring-inset ring-sky-300/60 dark:ring-sky-700/60"
          : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/50"
      }`}
      style={{ paddingLeft: indent + 20 }}
    >
      <span className="flex items-center gap-1.5 min-w-0">
        <span className="text-sm leading-none w-4 text-center text-slate-500">
          {iconForEntry(entry)}
        </span>
        <span className="truncate font-mono">{entry.name}</span>
      </span>
      <span className="text-[10px] text-slate-400 shrink-0 tabular-nums">
        {formatSize(entry.size)}
      </span>
    </button>
  )
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
        // biome-ignore lint/suspicious/noArrayIndexKey: breadcrumb segments are positionally stable per path
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
  children,
  testId,
  title,
}: {
  onClick?: () => void
  href?: string
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
        target="_blank"
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

const CodeView = ({ content }: { content: string }) => {
  const lines = useMemo(() => content.split("\n"), [content])
  return (
    <div
      data-testid="file-code"
      className="text-[12px] font-mono leading-snug bg-slate-50 dark:bg-slate-950/60 overflow-auto h-full"
    >
      <table className="border-separate border-spacing-0 w-full">
        <tbody>
          {lines.map((l, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: line numbers are positionally stable per fetch
            <tr key={i} className="hover:bg-slate-100/60 dark:hover:bg-slate-900/60">
              <td className="select-none text-right pr-3 pl-3 text-slate-400 dark:text-slate-600 w-12 align-top">
                {i + 1}
              </td>
              <td className="whitespace-pre text-slate-800 dark:text-slate-200 align-top pr-4">
                {l || " "}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const FileBody = ({
  projectId,
  file,
  kind,
}: {
  projectId: string
  file: FileContent
  kind: FileKind
}) => {
  const rawUrl = projectRawUrl(projectId, file.path)
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
      return <CodeView content={file.content} />
  }
}

const FilePreview = ({ projectId, path }: { projectId: string; path: string }) => {
  const q = useProjectFile(projectId, path)
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
  const rawUrl = projectRawUrl(projectId, f.path)
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
          <ToolbarButton onClick={copyPath} testId="file-copy-path" title="Copy path">
            {copied ? "Copied" : "Copy path"}
          </ToolbarButton>
          <ToolbarButton href={rawUrl} testId="file-open-raw" title="Open raw file in a new tab">
            Open raw ↗
          </ToolbarButton>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <FileBody projectId={projectId} file={f} kind={kind} />
      </div>
    </div>
  )
}

export const FileTree = ({ projectId, onPick }: Props) => {
  const [selected, setSelected] = useState<string | null>(null)
  const [filter, setFilter] = useState("")
  const pick = (path: string) => {
    setSelected(path)
    onPick?.(path)
  }
  return (
    <div
      data-testid="project-file-tree"
      className="grid grid-cols-1 md:grid-cols-[minmax(240px,320px)_1fr] gap-0 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white/60 dark:bg-slate-900/60 shadow-sm flex-1 min-h-0"
    >
      <aside className="flex flex-col min-h-0 border-r border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40">
        <div className="px-2 py-2 border-b border-slate-200 dark:border-slate-800">
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter files…"
            data-testid="file-filter"
            className="w-full text-xs px-2 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-sky-400"
          />
        </div>
        <div data-testid="file-tree-scroll" className="flex-1 min-h-0 overflow-auto py-1.5 px-1">
          <DirNode
            projectId={projectId}
            path=""
            name="."
            depth={0}
            selected={selected}
            filter={filter}
            onPick={pick}
          />
        </div>
      </aside>
      <section className="min-h-0 overflow-hidden">
        {selected ? (
          <FilePreview projectId={projectId} path={selected} />
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 h-full text-slate-500 text-center px-6">
            <div className="text-4xl">📂</div>
            <div className="text-sm font-medium">Pick a file to preview</div>
            <div className="text-xs text-slate-400 max-w-sm">
              Markdown renders as Markdown · HTML opens in a sandboxed frame · images, PDFs, audio
              and video play inline.
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
