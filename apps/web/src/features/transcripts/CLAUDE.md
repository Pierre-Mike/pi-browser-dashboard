# transcripts

Chat-style renderer for `GET /sessions/:id/transcript` JSONL.

- `flattenContent.ts` — pure normalizer. Takes the polymorphic JSONL `content` payload (string, array of typed parts, or arbitrary object) and emits a flat `Block[]` of `text | thinking | tool_use | tool_result`. Drops empty `thinking` rows — Claude Code persists finalized thinking blocks with the visible text stripped and only the signature retained, so an empty-text chip would expand to nothing.
- `TranscriptView.tsx` — bubbles (`UserBubble`, `AssistantBubble`, `ResultBubble`) keyed off `extractRole(m)`. Skips JSONL housekeeping rows that have no chat-visible content (system events, queue-operation, ai-title, stop_hook_summary, turn_duration, etc.). `ToolCall` collapses tool inputs to a one-line preview keyed off tool name (`Bash` → command, `Read/Edit/Write` → file path, `Grep` → pattern, …), expandable to a JSON dump. `ToolResult` collapses long output. User messages that are purely `tool_result` blocks render as a left-side standalone, not a user bubble.
