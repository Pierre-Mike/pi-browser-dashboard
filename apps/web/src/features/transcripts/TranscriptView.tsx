import { useState } from "react"
import type { TranscriptMessage } from "../../lib/types"
import { type Block, asString, flattenContent } from "./flattenContent"

type Props = { messages: readonly TranscriptMessage[] }

const extractRole = (m: TranscriptMessage): string => {
  if (m.message && typeof m.message === "object") {
    const role = (m.message as Record<string, unknown>).role
    if (typeof role === "string") return role
  }
  return m.type
}

const extractContent = (m: TranscriptMessage): unknown => {
  if (m.content !== undefined) return m.content
  if (m.message && typeof m.message === "object") {
    return (m.message as Record<string, unknown>).content
  }
  if (typeof m.text === "string") return m.text
  return null
}

const timeStr = (iso: string | undefined): string => {
  if (!iso) return ""
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ""
  const d = new Date(t)
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

const TOOL_ICON: Record<string, string> = {
  Bash: "$",
  Read: "📄",
  Edit: "✎",
  Write: "✎",
  Grep: "⌕",
  Glob: "⌕",
  TodoWrite: "☑",
  WebFetch: "🌐",
  WebSearch: "🌐",
  Task: "🤖",
  NotebookEdit: "✎",
  ExitPlanMode: "✓",
}

const toolPreview = (name: string, input: unknown): string => {
  if (input == null || typeof input !== "object") return ""
  const obj = input as Record<string, unknown>
  const str = (v: unknown): string => (typeof v === "string" ? v : "")
  switch (name) {
    case "Bash":
      return str(obj.command)
    case "Read":
    case "Edit":
    case "Write":
    case "NotebookEdit":
      return str(obj.file_path) || str(obj.notebook_path) || str(obj.path)
    case "Grep": {
      const pat = str(obj.pattern)
      const path = str(obj.path)
      return path ? `${pat}  in ${path}` : pat
    }
    case "Glob":
      return str(obj.pattern)
    case "TodoWrite": {
      const todos = obj.todos
      if (Array.isArray(todos)) return `${todos.length} todo${todos.length === 1 ? "" : "s"}`
      return ""
    }
    case "WebFetch":
    case "WebSearch":
      return str(obj.url) || str(obj.query)
    case "Task":
      return str(obj.description) || str(obj.subagent_type)
    default:
      return asString(input).replace(/\s+/g, " ").slice(0, 120)
  }
}

const ToolCall = ({ name, input }: { name: string; input: unknown }) => {
  const [open, setOpen] = useState(false)
  const inputStr = asString(input)
  const preview = toolPreview(name, input)
  const icon = TOOL_ICON[name] ?? "▸"
  return (
    <div className="mt-1.5 text-[11px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800 text-left max-w-full"
      >
        <span className="text-slate-400 shrink-0 w-3 text-center">{open ? "▾" : "▸"}</span>
        <span className="shrink-0 font-mono" aria-hidden>
          {icon}
        </span>
        <span className="shrink-0 font-mono font-semibold text-slate-700 dark:text-slate-200">
          {name}
        </span>
        {!open && preview ? (
          <span className="font-mono text-slate-500 dark:text-slate-400 truncate min-w-0">
            {preview}
          </span>
        ) : null}
      </button>
      {open ? (
        <pre className="mt-1 rounded bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-2 text-[11px] font-mono overflow-x-auto whitespace-pre-wrap break-words text-slate-700 dark:text-slate-300">
          {inputStr}
        </pre>
      ) : null}
    </div>
  )
}

const Thinking = ({ text }: { text: string }) => {
  const [open, setOpen] = useState(false)
  const oneLine = text.replace(/\s+/g, " ").trim()
  const preview = oneLine.slice(0, 140)
  return (
    <div className="mt-1.5 text-[12px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-start gap-1.5 rounded-md border border-violet-200 dark:border-violet-900 bg-violet-50/70 dark:bg-violet-950/30 px-2 py-1 hover:bg-violet-100 dark:hover:bg-violet-900/40 text-left max-w-full"
        title="Internal reasoning"
      >
        <span className="text-violet-400 shrink-0 w-3 text-center mt-0.5">{open ? "▾" : "▸"}</span>
        <span className="shrink-0" aria-hidden>
          💭
        </span>
        <span className="shrink-0 text-[10px] uppercase tracking-wide font-semibold text-violet-700 dark:text-violet-300 mt-0.5">
          Thinking
        </span>
        {!open ? (
          <span className="italic text-violet-700/80 dark:text-violet-300/80 truncate min-w-0 mt-0.5">
            {preview}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="mt-1 rounded border border-violet-200 dark:border-violet-900 bg-violet-50/60 dark:bg-violet-950/20 p-2.5 text-[12px] italic text-violet-900 dark:text-violet-200 whitespace-pre-wrap break-words leading-relaxed">
          {text}
        </div>
      ) : null}
    </div>
  )
}

const ToolResult = ({ text, isError }: { text: string; isError?: boolean }) => {
  const [open, setOpen] = useState(false)
  const single = text.replace(/\s+/g, " ").slice(0, 90)
  return (
    <div className="mt-1 text-[11px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono ${
          isError
            ? "border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200"
            : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
        }`}
      >
        <span className="text-slate-400">{open ? "▾" : "▸"}</span>
        <span>{isError ? "error" : "result"}</span>
        {!open ? <span className="text-slate-400 truncate max-w-[40ch]">{single}</span> : null}
      </button>
      {open ? (
        <pre
          className={`mt-1 rounded p-2 text-[11px] font-mono overflow-x-auto whitespace-pre-wrap break-words ${
            isError
              ? "bg-rose-50 dark:bg-rose-950/40 text-rose-900 dark:text-rose-200 border border-rose-200 dark:border-rose-900"
              : "bg-slate-100 dark:bg-slate-950 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800"
          }`}
        >
          {text}
        </pre>
      ) : null}
    </div>
  )
}

const Avatar = ({ kind }: { kind: "user" | "assistant" | "system" }) => {
  const tone =
    kind === "user"
      ? "bg-sky-500 text-white"
      : kind === "assistant"
        ? "bg-slate-700 dark:bg-slate-300 text-white dark:text-slate-900"
        : "bg-amber-500 text-white"
  const letter = kind === "user" ? "U" : kind === "assistant" ? "C" : "S"
  return (
    <div
      className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0 ${tone}`}
      aria-hidden
    >
      {letter}
    </div>
  )
}

const UserBubble = ({ blocks, time }: { blocks: Block[]; time: string }) => (
  <div className="flex gap-2 w-full">
    <div className="flex flex-col items-end w-full min-w-0">
      <div className="w-full rounded-2xl rounded-tr-sm bg-sky-500 text-white px-3.5 py-2 shadow-sm text-right">
        {blocks.map((b, i) =>
          b.kind === "text" ? (
            <pre
              key={i}
              className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-right"
            >
              {b.text}
            </pre>
          ) : b.kind === "tool_result" ? (
            <div key={i} className="text-sky-50 text-left">
              <ToolResult text={b.text} isError={b.isError} />
            </div>
          ) : null,
        )}
      </div>
      {time ? <div className="text-[10px] text-slate-400 mt-0.5 px-1">{time}</div> : null}
    </div>
    <Avatar kind="user" />
  </div>
)

const AssistantBubble = ({ blocks, time }: { blocks: Block[]; time: string }) => (
  <div className="flex gap-2 w-full">
    <Avatar kind="assistant" />
    <div className="flex flex-col items-start w-full min-w-0">
      <div className="w-full rounded-2xl rounded-tl-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-3.5 py-2 text-slate-900 dark:text-slate-100 shadow-sm">
        {blocks.length === 0 ? (
          <span className="text-slate-400 italic text-sm">…</span>
        ) : (
          blocks.map((b, i) => {
            if (b.kind === "text") {
              return (
                <pre
                  key={i}
                  className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed"
                >
                  {b.text}
                </pre>
              )
            }
            if (b.kind === "thinking") {
              return <Thinking key={i} text={b.text} />
            }
            if (b.kind === "tool_use") {
              return <ToolCall key={i} name={b.name} input={b.input} />
            }
            return <ToolResult key={i} text={b.text} isError={b.isError} />
          })
        )}
      </div>
      {time ? <div className="text-[10px] text-slate-400 mt-0.5 px-1">{time}</div> : null}
    </div>
  </div>
)

const ResultBubble = ({ text, time }: { text: string; time: string }) => (
  <div className="flex justify-center">
    <div className="max-w-[78%] rounded-xl border border-emerald-300 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 text-emerald-900 dark:text-emerald-100 text-xs">
      <div className="text-[10px] uppercase tracking-wide font-semibold opacity-60 mb-0.5">
        Result {time ? `· ${time}` : ""}
      </div>
      <pre className="whitespace-pre-wrap break-words font-sans">{text}</pre>
    </div>
  </div>
)

export const TranscriptView = ({ messages }: Props) => {
  return (
    <div className="flex flex-col gap-2.5">
      {messages.map((m, i) => {
        const role = extractRole(m)
        const time = timeStr(m.timestamp)
        const blocks = flattenContent(extractContent(m))

        // Skip JSONL housekeeping rows that have no chat-visible content:
        // system events, queue-operation, ai-title, agent-name, permission-mode,
        // last-prompt, stop_hook_summary, turn_duration, etc.
        const isChatRole = role === "user" || role === "assistant" || role === "result"
        const isResultType = m.type === "result"
        if (!isChatRole && !isResultType) return null

        if (role === "user") {
          // Drop empty/null user rows (e.g. supervisor housekeeping with role:"user").
          if (blocks.length === 0) return null
          // User-side messages may carry tool_result blocks (model-supplied). If the message is
          // purely tool_results, render them as a small standalone block instead of a user bubble.
          const allToolResults = blocks.every((b) => b.kind === "tool_result")
          if (allToolResults) {
            return (
              <div key={i} className="flex justify-start gap-2 pl-9">
                <div className="flex flex-col items-start w-full min-w-0">
                  {blocks.map((b, j) =>
                    b.kind === "tool_result" ? (
                      <ToolResult key={j} text={b.text} isError={b.isError} />
                    ) : null,
                  )}
                </div>
              </div>
            )
          }
          return <UserBubble key={i} blocks={blocks} time={time} />
        }

        if (role === "assistant") {
          if (blocks.length === 0) return null
          return <AssistantBubble key={i} blocks={blocks} time={time} />
        }

        // result
        const text = typeof m.result === "string" ? m.result : asString(extractContent(m))
        if (!text || text === "null") return null
        return <ResultBubble key={i} text={text} time={time} />
      })}
    </div>
  )
}
