// GFM table alignment → Tailwind class. remark-gfm carries a cell's alignment
// on the hast node's `align` property (e.g. `:-:` → "center"); rehype-sanitize
// keeps it, but our custom th/td components must apply it themselves or every
// cell renders left-aligned.

const ALIGN_CLASS: Record<string, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
}

// Map a node's `align` property (unknown shape post-parse) to a text-align
// class, defaulting to left for absent or unrecognised values.
export const alignClass = (align: unknown): string =>
  (typeof align === "string" && ALIGN_CLASS[align]) || "text-left"
