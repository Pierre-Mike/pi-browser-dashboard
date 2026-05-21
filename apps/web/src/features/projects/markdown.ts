// Minimal, safe Markdown → AST. Covers headings (#..######), paragraphs,
// fenced code blocks (```lang\n…```), unordered (- / *) and ordered (1.) lists,
// blockquotes (>), horizontal rules (---), inline code (`x`), bold (**x**),
// italic (*x* and _x_), and links ([text](href)). Anything not recognised
// degrades to a plain text span, so untrusted input cannot inject HTML.

export type MdSpan =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "strong"; readonly spans: readonly MdSpan[] }
  | { readonly kind: "em"; readonly spans: readonly MdSpan[] }
  | { readonly kind: "link"; readonly href: string; readonly spans: readonly MdSpan[] }

export type MdBlock =
  | {
      readonly kind: "heading"
      readonly level: 1 | 2 | 3 | 4 | 5 | 6
      readonly spans: readonly MdSpan[]
    }
  | { readonly kind: "paragraph"; readonly spans: readonly MdSpan[] }
  | { readonly kind: "ul"; readonly items: readonly (readonly MdSpan[])[] }
  | { readonly kind: "ol"; readonly items: readonly (readonly MdSpan[])[] }
  | { readonly kind: "blockquote"; readonly spans: readonly MdSpan[] }
  | { readonly kind: "code"; readonly lang: string; readonly text: string }
  | { readonly kind: "hr" }

const isSafeHref = (href: string): boolean => {
  const h = href.trim().toLowerCase()
  if (h.startsWith("javascript:") || h.startsWith("data:") || h.startsWith("vbscript:")) {
    return false
  }
  return true
}

export const parseInline = (text: string): readonly MdSpan[] => {
  const spans: MdSpan[] = []
  let buf = ""
  let i = 0
  const flush = (): void => {
    if (buf) {
      spans.push({ kind: "text", text: buf })
      buf = ""
    }
  }
  while (i < text.length) {
    const ch = text[i] ?? ""
    // Inline code: `…`
    if (ch === "`") {
      const end = text.indexOf("`", i + 1)
      if (end > i) {
        flush()
        spans.push({ kind: "code", text: text.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }
    // Bold: **…**
    if (ch === "*" && text[i + 1] === "*") {
      const end = text.indexOf("**", i + 2)
      if (end > i + 1) {
        flush()
        spans.push({ kind: "strong", spans: parseInline(text.slice(i + 2, end)) })
        i = end + 2
        continue
      }
    }
    // Italic: *…* or _…_
    if (ch === "*" || ch === "_") {
      const end = text.indexOf(ch, i + 1)
      if (end > i && text[end - 1] !== " ") {
        flush()
        spans.push({ kind: "em", spans: parseInline(text.slice(i + 1, end)) })
        i = end + 1
        continue
      }
    }
    // Link: [text](href)
    if (ch === "[") {
      const close = text.indexOf("]", i + 1)
      if (close > i && text[close + 1] === "(") {
        const hrefEnd = text.indexOf(")", close + 2)
        if (hrefEnd > close + 1) {
          const href = text.slice(close + 2, hrefEnd)
          if (isSafeHref(href)) {
            flush()
            spans.push({
              kind: "link",
              href,
              spans: parseInline(text.slice(i + 1, close)),
            })
            i = hrefEnd + 1
            continue
          }
        }
      }
    }
    buf += ch
    i += 1
  }
  flush()
  return spans
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/
const UL_RE = /^[-*]\s+(.*)$/
const OL_RE = /^\d+\.\s+(.*)$/
const HR_RE = /^(?:-{3,}|\*{3,}|_{3,})$/

export const parseMarkdown = (input: string): readonly MdBlock[] => {
  const lines = input.replace(/\r\n?/g, "\n").split("\n")
  const blocks: MdBlock[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ""
    if (line.trim() === "") {
      i += 1
      continue
    }
    // Fenced code: ```lang
    const fence = /^```\s*([\w+-]*)\s*$/.exec(line)
    if (fence) {
      const lang = fence[1] ?? ""
      const start = i + 1
      let end = start
      while (end < lines.length && !/^```\s*$/.test(lines[end] ?? "")) end += 1
      const text = lines.slice(start, end).join("\n")
      blocks.push({ kind: "code", lang, text })
      i = end + 1
      continue
    }
    const hr = HR_RE.exec(line.trim())
    if (hr) {
      blocks.push({ kind: "hr" })
      i += 1
      continue
    }
    const h = HEADING_RE.exec(line)
    if (h) {
      const hashes = h[1] ?? "#"
      const level = Math.min(6, hashes.length) as 1 | 2 | 3 | 4 | 5 | 6
      blocks.push({ kind: "heading", level, spans: parseInline(h[2] ?? "") })
      i += 1
      continue
    }
    const ul = UL_RE.exec(line)
    if (ul) {
      const items: MdSpan[][] = [[...parseInline(ul[1] ?? "")]]
      i += 1
      while (i < lines.length) {
        const m = UL_RE.exec(lines[i] ?? "")
        if (!m) break
        items.push([...parseInline(m[1] ?? "")])
        i += 1
      }
      blocks.push({ kind: "ul", items })
      continue
    }
    const ol = OL_RE.exec(line)
    if (ol) {
      const items: MdSpan[][] = [[...parseInline(ol[1] ?? "")]]
      i += 1
      while (i < lines.length) {
        const m = OL_RE.exec(lines[i] ?? "")
        if (!m) break
        items.push([...parseInline(m[1] ?? "")])
        i += 1
      }
      blocks.push({ kind: "ol", items })
      continue
    }
    if (line.startsWith(">")) {
      const buf: string[] = [line.slice(1).trimStart()]
      i += 1
      while (i < lines.length && (lines[i] ?? "").startsWith(">")) {
        buf.push((lines[i] ?? "").slice(1).trimStart())
        i += 1
      }
      blocks.push({ kind: "blockquote", spans: parseInline(buf.join(" ")) })
      continue
    }
    // Paragraph: consume lines until blank line or block boundary.
    const buf: string[] = [line]
    i += 1
    while (i < lines.length) {
      const next = lines[i] ?? ""
      if (
        next.trim() === "" ||
        HEADING_RE.test(next) ||
        UL_RE.test(next) ||
        OL_RE.test(next) ||
        HR_RE.test(next.trim()) ||
        next.startsWith(">") ||
        /^```/.test(next)
      ) {
        break
      }
      buf.push(next)
      i += 1
    }
    blocks.push({ kind: "paragraph", spans: parseInline(buf.join(" ")) })
  }
  return blocks
}
