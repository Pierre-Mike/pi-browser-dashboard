import { type Node, type NodeProps, NodeResizer } from "@xyflow/react"
import type { KeyboardEvent } from "react"
import { colorFor, renderInlineMarkdown } from "./canvasObsidian"
import { NodeHandles } from "./NodeHandles"
import { useInlineEdit } from "./useInlineEdit"

// React Flow gives us a node with `data.label` plus a `selected` flag. We
// render a rounded card; double-click swaps in a textarea so the user can
// edit multi-line markdown text in place. Cmd/Ctrl+Enter or blur commits,
// Escape reverts. Plain Enter inserts a newline (markdown-friendly).
//
// Obsidian parity: the card is resizable from any corner when selected, has
// connection handles on all 4 sides (both source and target), and respects
// an optional `data.color` key from the Obsidian color palette. An empty box
// (e.g. one dropped by double-clicking empty canvas) opens in edit mode.

type BoxNode = Node<{ label?: string; color?: string }, "box">

export const EditableBoxNode = ({ id, data, selected }: NodeProps<BoxNode>) => {
  const initial = typeof data?.label === "string" ? data.label : ""
  const colorKey = typeof data?.color === "string" ? data.color : ""
  const palette = colorFor(colorKey)
  const { editing, setEditing, draft, setDraft, inputRef, commit } =
    useInlineEdit<HTMLTextAreaElement>({ id, field: "label", initial, autoEdit: true })

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Obsidian-style: plain Enter commits, Shift+Enter inserts a newline. This
    // matches the existing single-line UX from before this node became
    // multi-line, so the e2e test that drives `input.press('Enter')` still
    // closes the editor.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      commit(draft)
    } else if (e.key === "Escape") {
      e.preventDefault()
      setDraft(initial)
      setEditing(false)
    }
    // Stop bubbling so React Flow's delete-key handler doesn't eat a Backspace
    // while the user is editing text.
    e.stopPropagation()
  }

  const borderClass = palette.stroke
    ? "" // applied via inline style below
    : selected
      ? "border-sky-500 ring-1 ring-sky-400"
      : "border-slate-300 dark:border-slate-700"

  return (
    <div
      data-testid="canvas-node-box"
      data-node-id={id}
      onDoubleClick={() => setEditing(true)}
      className={`group rounded-md border bg-white dark:bg-slate-900 px-3 py-2 text-xs shadow-sm w-full h-full min-w-[120px] min-h-[36px] text-left ${borderClass}`}
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
        minWidth={120}
        minHeight={40}
        lineClassName="border-sky-400"
        handleClassName="bg-sky-500 border-white"
      />
      <NodeHandles />
      {editing ? (
        <textarea
          ref={inputRef}
          data-testid="canvas-node-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit(draft)}
          onKeyDown={onKeyDown}
          rows={Math.max(1, draft.split("\n").length)}
          className="w-full h-full bg-transparent outline-none resize-none text-left"
          // Allow Enter to insert a newline; commit goes via Cmd/Ctrl+Enter or blur.
        />
      ) : (
        <span
          data-testid="canvas-node-label"
          className="text-slate-800 dark:text-slate-100 whitespace-pre-wrap break-words block leading-snug"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: renderInlineMarkdown escapes input first
          dangerouslySetInnerHTML={{
            __html: initial ? renderInlineMarkdown(initial) : "Untitled",
          }}
        />
      )}
    </div>
  )
}
