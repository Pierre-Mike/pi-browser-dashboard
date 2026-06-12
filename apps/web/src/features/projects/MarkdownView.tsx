import { File as PierreFile } from "@pierre/diffs/react"
import { Children, type ReactElement, type ReactNode } from "react"
import Markdown, { type Components } from "react-markdown"
import rehypeSanitize from "rehype-sanitize"
import remarkGfm from "remark-gfm"
import { CODE_FILE_OPTIONS } from "../diffs/diffsOptions"
import { MermaidView } from "./MermaidView"

// Markdown rendering is delegated to react-markdown (GFM via remark-gfm:
// tables, task lists, strikethrough, autolinks, footnotes) and made safe by
// rehype-sanitize, which strips any raw/embedded HTML and unsafe href schemes.
// Fenced code blocks are intercepted at the <pre> boundary: `mermaid` routes to
// MermaidView, everything else to @pierre/diffs for Shiki syntax highlighting.

const codeChildText = (children: ReactNode): string => String(children ?? "").replace(/\n$/, "")

const fenceLang = (className: string | undefined): string => {
  const match = /language-(\w+)/.exec(className ?? "")
  return match ? match[1] : ""
}

// A fenced code block lifted out of <pre>: mermaid renders as a diagram,
// everything else as a Shiki-highlighted @pierre/diffs File.
const FencedBlock = ({
  codeEl,
}: {
  codeEl: ReactElement<{ className?: string; children?: ReactNode }>
}) => {
  const lang = fenceLang(codeEl.props.className)
  const text = codeChildText(codeEl.props.children)
  if (lang.toLowerCase() === "mermaid") {
    return <MermaidView code={text} />
  }
  const name = lang ? `snippet.${lang}` : "snippet.txt"
  return (
    <div className="my-3 overflow-x-auto text-[12px] leading-snug">
      <PierreFile file={{ name, contents: text }} options={CODE_FILE_OPTIONS} />
    </div>
  )
}

const HEADING_CLASS: Record<number, string> = {
  1: "text-2xl font-bold mt-6 mb-3 border-b border-slate-200 dark:border-slate-800 pb-1.5",
  2: "text-xl font-bold mt-5 mb-2 border-b border-slate-200 dark:border-slate-800 pb-1",
  3: "text-lg font-semibold mt-4 mb-2",
  4: "text-base font-semibold mt-3 mb-1.5",
  5: "text-sm font-semibold mt-3 mb-1",
  6: "text-xs font-semibold uppercase tracking-wide mt-3 mb-1 text-slate-500",
}

const heading =
  (level: number) =>
  ({ children }: { children?: ReactNode }) => {
    const Tag = `h${level}` as keyof JSX.IntrinsicElements
    return <Tag className={HEADING_CLASS[level]}>{children}</Tag>
  }

const components: Components = {
  h1: heading(1),
  h2: heading(2),
  h3: heading(3),
  h4: heading(4),
  h5: heading(5),
  h6: heading(6),
  p: ({ children }) => <p className="my-3 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="list-disc pl-6 my-3 space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-6 my-3 space-y-1">{children}</ol>,
  li: ({ children }) => <li>{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-slate-300 dark:border-slate-700 pl-3 my-3 text-slate-600 dark:text-slate-300 italic">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-4 border-slate-200 dark:border-slate-800" />,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-sky-600 dark:text-sky-400 hover:underline"
    >
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full text-sm border-collapse">{children}</table>
    </div>
  ),
  tr: ({ children }) => (
    <tr className="border-b border-slate-200 dark:border-slate-800 last:border-b-0">{children}</tr>
  ),
  th: ({ children }) => <th className="px-3 py-1.5 font-semibold text-left">{children}</th>,
  td: ({ children }) => <td className="px-3 py-1.5 align-top text-left">{children}</td>,
  // Inline code only — fenced blocks never reach here because `pre` owns them.
  code: ({ children }) => (
    <code className="px-1 py-0.5 rounded bg-slate-200/70 dark:bg-slate-800 font-mono text-[0.9em]">
      {children}
    </code>
  ),
  // Own the whole fenced block so code components are never nested inside <pre>.
  pre: ({ children }) => (
    <FencedBlock
      codeEl={Children.only(children) as ReactElement<{ className?: string; children?: ReactNode }>}
    />
  ),
}

type Props = { text: string }

export const MarkdownView = ({ text }: Props) => (
  <div
    data-testid="markdown-rendered"
    className="prose prose-slate dark:prose-invert max-w-none text-sm text-slate-800 dark:text-slate-200 px-5 py-4"
  >
    <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={components}>
      {text}
    </Markdown>
  </div>
)
