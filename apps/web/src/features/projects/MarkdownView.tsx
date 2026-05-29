import { useMemo } from "react"
import { MermaidView } from "./MermaidView"
import { type MdAlign, type MdBlock, type MdSpan, parseMarkdown } from "./markdown"

const ALIGN_CLASS: Record<Exclude<MdAlign, null>, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
}

const SpanItem = ({ span }: { span: MdSpan }): React.ReactElement => {
  switch (span.kind) {
    case "text":
      return <span>{span.text}</span>
    case "code":
      return (
        <code className="px-1 py-0.5 rounded bg-slate-200/70 dark:bg-slate-800 font-mono text-[0.9em]">
          {span.text}
        </code>
      )
    case "strong":
      return <strong className="font-semibold">{renderSpans(span.spans)}</strong>
    case "em":
      return <em className="italic">{renderSpans(span.spans)}</em>
    case "link":
      return (
        <a
          href={span.href}
          target="_blank"
          rel="noreferrer noopener"
          className="text-sky-600 dark:text-sky-400 hover:underline"
        >
          {renderSpans(span.spans)}
        </a>
      )
  }
}

const renderSpans = (spans: readonly MdSpan[]): React.ReactNode =>
  spans.map((s, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: spans are positionally stable per parse
    <SpanItem key={i} span={s} />
  ))

const BlockItem = ({ block }: { block: MdBlock }): React.ReactElement => {
  switch (block.kind) {
    case "heading": {
      const cls = {
        1: "text-2xl font-bold mt-6 mb-3 border-b border-slate-200 dark:border-slate-800 pb-1.5",
        2: "text-xl font-bold mt-5 mb-2 border-b border-slate-200 dark:border-slate-800 pb-1",
        3: "text-lg font-semibold mt-4 mb-2",
        4: "text-base font-semibold mt-3 mb-1.5",
        5: "text-sm font-semibold mt-3 mb-1",
        6: "text-xs font-semibold uppercase tracking-wide mt-3 mb-1 text-slate-500",
      }[block.level]
      const Tag = `h${block.level}` as keyof JSX.IntrinsicElements
      return <Tag className={cls}>{renderSpans(block.spans)}</Tag>
    }
    case "paragraph":
      return <p className="my-3 leading-relaxed">{renderSpans(block.spans)}</p>
    case "ul":
      return (
        <ul className="list-disc pl-6 my-3 space-y-1">
          {block.items.map((spans, j) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: list items are positionally stable per parse
            <li key={j}>{renderSpans(spans)}</li>
          ))}
        </ul>
      )
    case "ol":
      return (
        <ol className="list-decimal pl-6 my-3 space-y-1">
          {block.items.map((spans, j) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: list items are positionally stable per parse
            <li key={j}>{renderSpans(spans)}</li>
          ))}
        </ol>
      )
    case "blockquote":
      return (
        <blockquote className="border-l-4 border-slate-300 dark:border-slate-700 pl-3 my-3 text-slate-600 dark:text-slate-300 italic">
          {renderSpans(block.spans)}
        </blockquote>
      )
    case "code":
      if (block.lang.toLowerCase() === "mermaid") {
        return <MermaidView code={block.text} />
      }
      return (
        <pre className="my-3 px-3 py-2 rounded-md bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-x-auto text-[12px] font-mono">
          {block.lang ? (
            <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">
              {block.lang}
            </div>
          ) : null}
          <code>{block.text}</code>
        </pre>
      )
    case "hr":
      return <hr className="my-4 border-slate-200 dark:border-slate-800" />
    case "table":
      return (
        <div className="my-3 overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-slate-300 dark:border-slate-700">
                {block.headers.map((cell, j) => {
                  const align = block.aligns[j] ?? null
                  return (
                    <th
                      // biome-ignore lint/suspicious/noArrayIndexKey: table header cells are positionally stable per parse
                      key={j}
                      className={`px-3 py-1.5 font-semibold ${
                        align ? ALIGN_CLASS[align] : "text-left"
                      }`}
                    >
                      {renderSpans(cell)}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => (
                <tr
                  // biome-ignore lint/suspicious/noArrayIndexKey: rows are positionally stable per parse
                  key={ri}
                  className="border-b border-slate-200 dark:border-slate-800 last:border-b-0"
                >
                  {row.map((cell, ci) => {
                    const align = block.aligns[ci] ?? null
                    return (
                      <td
                        // biome-ignore lint/suspicious/noArrayIndexKey: cells are positionally stable per parse
                        key={ci}
                        className={`px-3 py-1.5 align-top ${
                          align ? ALIGN_CLASS[align] : "text-left"
                        }`}
                      >
                        {renderSpans(cell)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
  }
}

type Props = { text: string }

export const MarkdownView = ({ text }: Props) => {
  const blocks = useMemo(() => parseMarkdown(text), [text])
  return (
    <div
      data-testid="markdown-rendered"
      className="prose prose-slate dark:prose-invert max-w-none text-sm text-slate-800 dark:text-slate-200 px-5 py-4"
    >
      {blocks.map((b, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: blocks are positionally stable per parse
        <BlockItem key={i} block={b} />
      ))}
    </div>
  )
}
