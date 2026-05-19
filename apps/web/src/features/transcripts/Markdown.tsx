import type { ComponentPropsWithoutRef, ReactNode } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"

type Tone = "user" | "default"

type Props = {
  text: string
  tone?: Tone
}

const baseComponents = (tone: Tone): Components => {
  const isUser = tone === "user"
  const linkClass = isUser
    ? "underline underline-offset-2 hover:opacity-80"
    : "text-sky-600 dark:text-sky-400 hover:underline"
  const codeBg = isUser
    ? "bg-sky-600/40 text-white"
    : "bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200"
  const preBg = isUser
    ? "bg-sky-700/50 text-white"
    : "bg-slate-100 dark:bg-slate-950 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-800"
  const blockquoteClass = isUser
    ? "border-l-2 border-white/60 pl-3 opacity-90"
    : "border-l-2 border-slate-300 dark:border-slate-700 pl-3 text-slate-700 dark:text-slate-300"
  const tableBorder = isUser ? "border-white/40" : "border-slate-300 dark:border-slate-700"
  const thBg = isUser ? "bg-sky-600/40" : "bg-slate-100 dark:bg-slate-800"
  return {
    p: ({ children }) => <p className="my-1 first:mt-0 last:mb-0 leading-relaxed">{children}</p>,
    h1: ({ children }) => (
      <h1 className="mt-2 mb-1 text-base font-semibold leading-tight">{children}</h1>
    ),
    h2: ({ children }) => (
      <h2 className="mt-2 mb-1 text-[15px] font-semibold leading-tight">{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="mt-2 mb-1 text-sm font-semibold leading-tight">{children}</h3>
    ),
    h4: ({ children }) => <h4 className="mt-2 mb-1 text-sm font-semibold">{children}</h4>,
    h5: ({ children }) => <h5 className="mt-2 mb-1 text-sm font-semibold">{children}</h5>,
    h6: ({ children }) => <h6 className="mt-2 mb-1 text-sm font-semibold">{children}</h6>,
    ul: ({ children }) => <ul className="my-1 ml-5 list-disc space-y-0.5">{children}</ul>,
    ol: ({ children }) => <ol className="my-1 ml-5 list-decimal space-y-0.5">{children}</ol>,
    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
    a: ({ href, children }) => (
      <a href={href} target="_blank" rel="noopener noreferrer" className={linkClass}>
        {children}
      </a>
    ),
    blockquote: ({ children }) => (
      <blockquote className={`my-1 ${blockquoteClass}`}>{children}</blockquote>
    ),
    hr: () => (
      <hr
        className={`my-2 border-0 border-t ${isUser ? "border-white/40" : "border-slate-200 dark:border-slate-800"}`}
      />
    ),
    code: ({
      className,
      children,
      ...rest
    }: ComponentPropsWithoutRef<"code"> & {
      children?: ReactNode
    }) => {
      // react-markdown v9+ no longer passes an `inline` prop; detect a fenced
      // block by the language-* class injected from the info string.
      const isBlock = typeof className === "string" && /language-/.test(className)
      if (isBlock) {
        return (
          <code className={`${className ?? ""} font-mono text-[12px]`} {...rest}>
            {children}
          </code>
        )
      }
      return (
        <code className={`rounded px-1 py-0.5 font-mono text-[12px] ${codeBg}`} {...rest}>
          {children}
        </code>
      )
    },
    pre: ({ children }) => (
      <pre
        className={`my-1.5 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words text-[12px] font-mono ${preBg}`}
      >
        {children}
      </pre>
    ),
    table: ({ children }) => (
      <div className="my-1.5 overflow-x-auto">
        <table className={`w-full border-collapse text-[12px] border ${tableBorder}`}>
          {children}
        </table>
      </div>
    ),
    th: ({ children }) => (
      <th className={`border px-2 py-1 text-left font-semibold ${tableBorder} ${thBg}`}>
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className={`border px-2 py-1 align-top ${tableBorder}`}>{children}</td>
    ),
    strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
    em: ({ children }) => <em className="italic">{children}</em>,
  }
}

export const Markdown = ({ text, tone = "default" }: Props) => (
  <div className="text-sm leading-relaxed">
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={baseComponents(tone)}>
      {text}
    </ReactMarkdown>
  </div>
)
