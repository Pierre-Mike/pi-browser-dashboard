export type Block =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool_use"; name: string; input: unknown; id?: string }
  | { kind: "tool_result"; text: string; isError?: boolean }

export const asString = (v: unknown): string => {
  if (typeof v === "string") return v
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

export const flattenContent = (raw: unknown): Block[] => {
  if (raw == null) return []
  if (typeof raw === "string") return [{ kind: "text", text: raw }]
  if (!Array.isArray(raw)) return [{ kind: "text", text: asString(raw) }]
  const out: Block[] = []
  for (const part of raw) {
    if (part == null || typeof part !== "object") {
      out.push({ kind: "text", text: asString(part) })
      continue
    }
    const p = part as Record<string, unknown>
    const t = p.type
    if (t === "text" && typeof p.text === "string") {
      out.push({ kind: "text", text: p.text })
    } else if (t === "thinking" && typeof p.thinking === "string") {
      // Claude Code persists finalized thinking blocks with the visible text
      // stripped and only the signature retained. Drop those so we don't render
      // an empty chip that expands to nothing.
      if (p.thinking.trim().length === 0) continue
      out.push({ kind: "thinking", text: p.thinking })
    } else if (t === "tool_use") {
      out.push({
        kind: "tool_use",
        name: typeof p.name === "string" ? p.name : "tool",
        input: p.input,
        id: typeof p.id === "string" ? p.id : undefined,
      })
    } else if (t === "tool_result") {
      out.push({
        kind: "tool_result",
        text: asString(p.content),
        isError: Boolean(p.is_error),
      })
    } else {
      out.push({ kind: "text", text: asString(part) })
    }
  }
  return out
}
