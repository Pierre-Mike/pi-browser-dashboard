import { type Node, type NodeProps, NodeResizer } from "@xyflow/react"
import type { CSSProperties, KeyboardEvent } from "react"
import { defaultLinkUrl, shouldOpenLink } from "./canvasInteractions"
import { colorFor } from "./canvasObsidian"
import { NodeHandles } from "./NodeHandles"
import { useInlineEdit } from "./useInlineEdit"

type Palette = { stroke: string; fill: string }

// Obsidian Canvas exposes a "link" node type — a card with a URL. We keep the
// rendering simple: the URL is shown as a clickable host pill plus the full
// URL underneath. Double-click to edit the URL; ctrl-click the host to open in
// a new tab. We deliberately don't embed an iframe (CSP/sandbox surface area)
// — users open the link to follow it.

type LinkNode = Node<{ url?: string; color?: string }, "link">

const hostOf = (raw: string): string => {
  try {
    return new URL(raw).host
  } catch {
    return raw
  }
}

const isSafeUrl = (raw: string): boolean => /^https?:\/\//i.test(raw.trim())

// Local-first: a brand-new (empty) link seeds the editor with the project's
// own origin so the common case — linking somewhere inside the running app —
// is one keystroke away.
const projectLocalUrl = (): string =>
  typeof window !== "undefined" ? defaultLinkUrl(window.location.origin) : ""

const cardClass = (palette: Palette, selected: boolean): string => {
  if (palette.stroke) return ""
  return selected ? "border-primary/30 ring-1 ring-primary" : "border-base-300"
}

const cardStyle = (palette: Palette, selected: boolean): CSSProperties | undefined =>
  palette.stroke
    ? {
        borderColor: palette.stroke,
        boxShadow: selected ? `0 0 0 1px ${palette.stroke}` : undefined,
        backgroundColor: palette.fill || undefined,
      }
    : undefined

// The non-editing body: a clickable host pill (for safe http(s) URLs) or a
// placeholder, with the full reference shown beneath whenever one is set.
const LinkBody = ({ url }: { url: string }) => (
  <>
    {url && isSafeUrl(url) ? (
      <a
        data-testid="canvas-link-href"
        href={url}
        target="_blank"
        rel="noreferrer"
        title="⌘/Ctrl-click to open · double-click to edit"
        className="block text-primary underline truncate"
        onClick={(e) => {
          e.stopPropagation()
          // A plain click / double-click is reserved for selecting and editing
          // the node; only a modifier click follows the link. Without the
          // preventDefault the first click of a double-click would navigate and
          // the node could never be re-edited once it had a URL.
          if (!shouldOpenLink(e)) e.preventDefault()
        }}
      >
        {hostOf(url)}
      </a>
    ) : (
      <span data-testid="canvas-link-placeholder" className="text-base-content/60 italic">
        (link)
      </span>
    )}
    {url ? <div className="mt-1 text-[10px] text-base-content/60 truncate">{url}</div> : null}
  </>
)

export const EditableLinkNode = ({ id, data, selected }: NodeProps<LinkNode>) => {
  const initial = typeof data?.url === "string" ? data.url : ""
  const colorKey = typeof data?.color === "string" ? data.color : ""
  const palette = colorFor(colorKey)
  const { editing, setEditing, draft, setDraft, inputRef, commit } =
    useInlineEdit<HTMLInputElement>({
      id,
      field: "url",
      initial,
      autoEdit: true,
      seedDraft: initial.length ? initial : projectLocalUrl(),
    })

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
      data-testid="canvas-node-link"
      data-node-id={id}
      onDoubleClick={() => setEditing(true)}
      className={`group rounded-md border bg-base-100 px-3 py-2 text-xs shadow-sm w-full h-full text-left ${cardClass(palette, selected)}`}
      style={cardStyle(palette, selected)}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={160}
        minHeight={64}
        lineClassName="border-primary/30"
        handleClassName="bg-primary border-white"
      />
      <NodeHandles />
      {editing ? (
        <input
          ref={inputRef}
          data-testid="canvas-link-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit(draft)}
          onKeyDown={onKeyDown}
          placeholder="https://example.com"
          className="w-full bg-transparent outline-none"
        />
      ) : (
        <LinkBody url={initial} />
      )}
    </div>
  )
}
