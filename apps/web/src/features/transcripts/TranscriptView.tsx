import { useState } from "react"
import type { TranscriptMessage } from "../../lib/types"
import { ChatMarkdown } from "./ChatMarkdown"
import { asString } from "./flattenContent"
import {
  type PairedBlock,
  pairTranscript,
  type ToolResultInfo,
  transcriptItemKey,
} from "./pairTranscript"

type Props = { messages: readonly TranscriptMessage[] }

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

const StatusBadge = ({ result }: { result?: ToolResultInfo }) => {
  if (!result) {
    return (
      <span className="shrink-0 rounded-full bg-base-300 text-base-content/60 px-1.5 py-px text-[9px] uppercase tracking-wide">
        pending
      </span>
    )
  }
  return result.isError ? (
    <span className="shrink-0 rounded-full bg-error/15 text-error px-1.5 py-px text-[9px] uppercase tracking-wide">
      error
    </span>
  ) : (
    <span className="shrink-0 rounded-full bg-success/15 text-success px-1.5 py-px text-[9px] uppercase tracking-wide">
      ok
    </span>
  )
}

const ToolCall = ({
  name,
  input,
  result,
}: {
  name: string
  input: unknown
  result?: ToolResultInfo
}) => {
  const [open, setOpen] = useState(false)
  const inputStr = asString(input)
  const preview = toolPreview(name, input)
  const icon = TOOL_ICON[name] ?? "▸"
  return (
    <div className="mt-1.5 text-[11px] rounded-md border border-base-300 bg-base-200 max-w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2 py-1 hover:bg-base-300 text-left rounded-md"
      >
        <span className="text-base-content/60 shrink-0 w-3 text-center">{open ? "▾" : "▸"}</span>
        <span className="shrink-0 font-mono" aria-hidden>
          {icon}
        </span>
        <span className="shrink-0 font-mono font-semibold text-base-content/80">{name}</span>
        {!open && preview ? (
          <span className="font-mono text-base-content/60 truncate min-w-0 flex-1">{preview}</span>
        ) : (
          <span className="flex-1" />
        )}
        <StatusBadge result={result} />
      </button>
      {open ? (
        <div className="border-t border-base-300 px-2 py-1.5 flex flex-col gap-1.5">
          <div>
            <div className="text-[9px] uppercase tracking-wide text-base-content/60 mb-0.5">
              Arguments
            </div>
            <pre className="rounded bg-base-300 border border-base-300 p-2 text-[11px] font-mono overflow-x-auto whitespace-pre-wrap break-words text-base-content/80">
              {inputStr}
            </pre>
          </div>
          {result ? (
            <div>
              <div className="text-[9px] uppercase tracking-wide text-base-content/60 mb-0.5">
                Result
              </div>
              <pre
                className={`rounded p-2 text-[11px] font-mono overflow-x-auto whitespace-pre-wrap break-words border ${
                  result.isError
                    ? "bg-error/15 text-error border-error/30"
                    : "bg-base-300 text-base-content/80 border-base-300"
                }`}
              >
                {result.text}
              </pre>
            </div>
          ) : null}
        </div>
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
        className="inline-flex items-start gap-1.5 rounded-md border border-secondary/30 bg-secondary/10 px-2 py-1 hover:bg-secondary/20 text-left max-w-full"
        title="Internal reasoning"
      >
        <span className="text-secondary/60 shrink-0 w-3 text-center mt-0.5">
          {open ? "▾" : "▸"}
        </span>
        <span className="shrink-0" aria-hidden>
          💭
        </span>
        <span className="shrink-0 text-[10px] uppercase tracking-wide font-semibold text-secondary mt-0.5">
          Thinking
        </span>
        {!open ? (
          <span className="italic text-secondary/80 truncate min-w-0 mt-0.5">{preview}</span>
        ) : null}
      </button>
      {open ? (
        <div className="mt-1 rounded border border-secondary/30 bg-secondary/10 p-2.5 text-[12px] italic text-base-content whitespace-pre-wrap break-words leading-relaxed">
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
            ? "border-error/30 bg-error/15 text-error"
            : "border-base-300 bg-base-200 text-base-content/80 hover:bg-base-300"
        }`}
      >
        <span className="text-base-content/60">{open ? "▾" : "▸"}</span>
        <span>{isError ? "error" : "result"}</span>
        {!open ? (
          <span className="text-base-content/60 truncate max-w-[40ch]">{single}</span>
        ) : null}
      </button>
      {open ? (
        <pre
          className={`mt-1 rounded p-2 text-[11px] font-mono overflow-x-auto whitespace-pre-wrap break-words ${
            isError
              ? "bg-error/15 text-error border border-error/30"
              : "bg-base-300 text-base-content/80 border border-base-300"
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
      ? "bg-primary text-primary-content"
      : kind === "assistant"
        ? "bg-neutral text-neutral-content"
        : "bg-accent text-accent-content"
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

const simpleHash = (s: string): string => {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i)
  return (h >>> 0).toString(36)
}

const blockKey = (b: PairedBlock, idx: number): string => {
  if (b.kind === "text") return `text-${simpleHash(b.text.slice(0, 50))}`
  if (b.kind === "thinking") return `thinking-${simpleHash(b.text.slice(0, 50))}`
  if (b.kind === "tool_use") return `tool_use-${b.id || b.name}`
  return `tool_result-${simpleHash(b.text.slice(0, 50))}-${idx}`
}

const UserBubble = ({ blocks, time }: { blocks: PairedBlock[]; time: string }) => (
  <div className="flex gap-2 w-full">
    <div className="flex flex-col items-end w-full min-w-0">
      <div className="w-full rounded-2xl rounded-tr-sm bg-primary text-primary-content px-3.5 py-2 shadow-sm text-right">
        {blocks.map((b, i) =>
          b.kind === "text" ? (
            <pre
              key={blockKey(b, i)}
              className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-right"
            >
              {b.text}
            </pre>
          ) : b.kind === "tool_result" ? (
            <div key={blockKey(b, i)} className="text-primary-content/70 text-left">
              <ToolResult text={b.text} isError={b.isError} />
            </div>
          ) : null,
        )}
      </div>
      {time ? <div className="text-[10px] text-base-content/60 mt-0.5 px-1">{time}</div> : null}
    </div>
    <Avatar kind="user" />
  </div>
)

const AssistantBubble = ({ blocks, time }: { blocks: PairedBlock[]; time: string }) => (
  <div className="flex gap-2 w-full">
    <Avatar kind="assistant" />
    <div className="flex flex-col items-start w-full min-w-0">
      <div className="w-full rounded-2xl rounded-tl-sm bg-base-100 border border-base-300 px-3.5 py-2 text-base-content shadow-sm">
        {blocks.length === 0 ? (
          <span className="text-base-content/60 italic text-sm">…</span>
        ) : (
          blocks.map((b, i) => {
            if (b.kind === "text") {
              return <ChatMarkdown key={blockKey(b, i)} text={b.text} />
            }
            if (b.kind === "thinking") {
              return <Thinking key={blockKey(b, i)} text={b.text} />
            }
            if (b.kind === "tool_use") {
              return (
                <ToolCall key={blockKey(b, i)} name={b.name} input={b.input} result={b.result} />
              )
            }
            return <ToolResult key={blockKey(b, i)} text={b.text} isError={b.isError} />
          })
        )}
      </div>
      {time ? <div className="text-[10px] text-base-content/60 mt-0.5 px-1">{time}</div> : null}
    </div>
  </div>
)

const ResultBubble = ({ text, time }: { text: string; time: string }) => (
  <div className="flex justify-center">
    <div className="max-w-[78%] rounded-xl border border-success/30 bg-success/15 px-3 py-2 text-base-content text-xs">
      <div className="text-[10px] uppercase tracking-wide font-semibold opacity-60 mb-0.5">
        Result {time ? `· ${time}` : ""}
      </div>
      <ChatMarkdown text={text} />
    </div>
  </div>
)

export const TranscriptView = ({ messages }: Props) => {
  const items = pairTranscript(messages)
  return (
    <div className="flex flex-col gap-2.5">
      {items.map((item, i) => {
        const time = timeStr(item.timestamp)
        const key = transcriptItemKey(item, i)

        if (item.kind === "user") {
          return <UserBubble key={key} blocks={item.blocks} time={time} />
        }

        if (item.kind === "assistant") {
          return <AssistantBubble key={key} blocks={item.blocks} time={time} />
        }

        if (item.kind === "tool_results") {
          // Orphaned tool_results with no visible tool_use to fold into.
          return (
            <div key={key} className="flex justify-start gap-2 pl-9">
              <div className="flex flex-col items-start w-full min-w-0">
                {item.blocks.map((b, j) =>
                  b.kind === "tool_result" ? (
                    <ToolResult key={blockKey(b, j)} text={b.text} isError={b.isError} />
                  ) : null,
                )}
              </div>
            </div>
          )
        }

        return <ResultBubble key={key} text={item.text} time={time} />
      })}
    </div>
  )
}
