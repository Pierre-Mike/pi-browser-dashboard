import { type Node, type NodeProps, NodeResizer } from "@xyflow/react"
import {
  type ChangeEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"
import { classifyEmbed, dispatchCanvasImport, isLoadable } from "./canvasEmbed"
import { pickedFileRef } from "./canvasInteractions"
import { colorFor, renderInlineMarkdown } from "./canvasObsidian"
import { NodeHandles } from "./NodeHandles"
import { useInlineEdit } from "./useInlineEdit"

// JSON Canvas spec exposes a "file" node — a card referencing a vault file
// path. We mirror the wire shape: `data.file` holds the path. Rendering is
// deliberately read-only on the file contents (no preview parser here) so the
// node stays a stable reference; double-click to edit the path.

type FileNode = Node<{ file?: string; color?: string; locked?: boolean }, "file">

const basename = (p: string): string => {
  const cleaned = p.replace(/\\/g, "/")
  const i = cleaned.lastIndexOf("/")
  return i >= 0 ? cleaned.slice(i + 1) : cleaned
}

// Inline embed for the file-node body: image/PDF/markdown render directly,
// .canvas exposes an "Open" button that fetches and imports onto the parent
// canvas via the canvasEmbed bridge. Non-loadable paths (e.g. ~/notes/x.md)
// fall back to filename + path.
const FilePreview = ({ ref }: { ref: string }) => {
  const kind = classifyEmbed(ref)
  const loadable = isLoadable(ref)
  const [mdText, setMdText] = useState<string | null>(null)
  const [mdError, setMdError] = useState<string | null>(null)
  const [openingCanvas, setOpeningCanvas] = useState(false)

  useEffect(() => {
    if (kind !== "markdown" || !loadable) return
    let cancelled = false
    setMdText(null)
    setMdError(null)
    fetch(ref)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((txt) => {
        if (!cancelled) setMdText(txt)
      })
      .catch((err) => {
        if (!cancelled) setMdError(err instanceof Error ? err.message : "fetch failed")
      })
    return () => {
      cancelled = true
    }
  }, [kind, loadable, ref])

  const onOpenCanvas = useCallback(async () => {
    if (openingCanvas) return
    setOpeningCanvas(true)
    try {
      const r = await fetch(ref)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const text = await r.text()
      dispatchCanvasImport(text, ref)
    } catch (err) {
      console.error("[canvas] open .canvas failed", err)
    } finally {
      setOpeningCanvas(false)
    }
  }, [openingCanvas, ref])

  if (kind === "image" && loadable) {
    return (
      <div className="flex flex-col h-full">
        <img
          data-testid="canvas-file-image"
          src={ref}
          alt={basename(ref)}
          className="flex-1 min-h-0 object-contain"
          onError={(e) => {
            ;(e.currentTarget as HTMLImageElement).style.display = "none"
          }}
        />
        <span className="block text-[10px] text-base-content/60 truncate">{basename(ref)}</span>
      </div>
    )
  }

  if (kind === "pdf" && loadable) {
    return (
      <div className="flex flex-col h-full">
        <embed
          data-testid="canvas-file-pdf"
          src={ref}
          type="application/pdf"
          className="flex-1 min-h-0 w-full"
        />
        <span className="block text-[10px] text-base-content/60 truncate">{basename(ref)}</span>
      </div>
    )
  }

  if (kind === "markdown" && loadable) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        {mdError ? (
          <span data-testid="canvas-file-markdown-error" className="text-error text-[11px]">
            {mdError}
          </span>
        ) : mdText === null ? (
          <span className="text-base-content/60 italic text-[11px]">loading…</span>
        ) : (
          <span
            data-testid="canvas-file-markdown"
            className="text-base-content overflow-auto text-[11px] leading-snug"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: renderInlineMarkdown escapes input first
            dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(mdText.slice(0, 4000)) }}
          />
        )}
        <span className="block text-[10px] text-base-content/60 truncate mt-auto">
          {basename(ref)}
        </span>
      </div>
    )
  }

  if (kind === "canvas") {
    return (
      <div className="flex flex-col h-full">
        <span
          data-testid="canvas-file-name"
          className="block font-medium text-base-content truncate"
        >
          {basename(ref)}
        </span>
        <span className="block text-[10px] text-base-content/60 truncate mb-1">{ref}</span>
        <button
          type="button"
          data-testid="canvas-file-open-canvas"
          onClick={onOpenCanvas}
          disabled={!loadable || openingCanvas}
          className="rounded border border-primary/40 bg-primary/10 text-primary px-2 py-0.5 text-[11px] disabled:opacity-40"
        >
          {openingCanvas ? "Opening…" : "Open canvas"}
        </button>
      </div>
    )
  }

  return (
    <>
      <span data-testid="canvas-file-name" className="block font-medium text-base-content truncate">
        {basename(ref)}
      </span>
      <span className="block text-[10px] text-base-content/60 truncate">{ref}</span>
    </>
  )
}

export const EditableFileNode = ({ id, data, selected }: NodeProps<FileNode>) => {
  const initial = typeof data?.file === "string" ? data.file : ""
  const colorKey = typeof data?.color === "string" ? data.color : ""
  const palette = colorFor(colorKey)
  const { editing, setEditing, draft, setDraft, inputRef, commit } =
    useInlineEdit<HTMLInputElement>({ id, field: "file", initial, autoEdit: true })
  const pickerRef = useRef<HTMLInputElement | null>(null)

  // Native system file picker: open the OS dialog, then store the chosen
  // file's name as the reference (browsers don't expose the full path).
  const openPicker = useCallback(() => {
    pickerRef.current?.click()
  }, [])

  const onPicked = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const ref = pickedFileRef(e.target.files)
      e.target.value = ""
      if (ref) commit(ref)
    },
    [commit],
  )

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault()
      commit(draft)
    } else if (e.key === "Escape") {
      e.preventDefault()
      setDraft(initial)
      setEditing(false)
    }
    e.stopPropagation()
  }

  return (
    <div
      data-testid="canvas-node-file"
      data-node-id={id}
      onDoubleClick={() => setEditing(true)}
      className={`group rounded-md border bg-base-100 px-3 py-2 text-xs shadow-sm w-full h-full min-w-[160px] min-h-[48px] text-left ${
        palette.stroke ? "" : selected ? "border-primary ring-1 ring-primary/60" : "border-base-300"
      }`}
      style={
        palette.stroke
          ? {
              borderColor: palette.stroke,
              boxShadow: selected ? `0 0 0 1px ${palette.stroke}` : undefined,
              backgroundColor: palette.fill || undefined,
            }
          : undefined
      }
    >
      <NodeResizer
        isVisible={selected}
        minWidth={160}
        minHeight={48}
        lineClassName="border-primary"
        handleClassName="bg-primary border-base-100"
      />
      <NodeHandles />
      {editing ? (
        <div className="flex flex-col gap-1">
          <input
            ref={inputRef}
            data-testid="canvas-file-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commit(draft)}
            onKeyDown={onKeyDown}
            placeholder="path/to/file"
            className="w-full bg-transparent outline-none"
          />
          <button
            type="button"
            data-testid="canvas-file-browse"
            onMouseDown={(e) => e.preventDefault()}
            onClick={openPicker}
            className="self-start rounded border border-base-300 px-1.5 py-0.5 text-[11px] hover:bg-base-200"
          >
            Browse…
          </button>
          <input
            ref={pickerRef}
            type="file"
            data-testid="canvas-file-picker"
            onChange={onPicked}
            className="hidden"
          />
        </div>
      ) : initial ? (
        <FilePreview ref={initial} />
      ) : (
        <span data-testid="canvas-file-placeholder" className="text-base-content/60 italic">
          (file)
        </span>
      )}
    </div>
  )
}
