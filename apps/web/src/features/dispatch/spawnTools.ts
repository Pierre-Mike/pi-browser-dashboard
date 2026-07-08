// Pure helpers for the spawn modal's tool-allow selection. No React — the
// modal wires these to component state and the picker renders the result.
//
// Claude Code's `--tools <tools...>` flag takes a comma-separated subset of
// its built-in tool names (`""` disables all, omitting the flag or passing
// "default" allows all). This list is the canonical built-in set for the
// pinned CLI version this dashboard targets — kept in one place so the
// picker and the dispatch body can't drift.
// Source: https://code.claude.com/docs/en/tools-reference.md (v2.1.197).
export const ALL_SPAWN_TOOLS = [
  "Agent",
  "Artifact",
  "AskUserQuestion",
  "Bash",
  "CronCreate",
  "CronDelete",
  "CronList",
  "Edit",
  "EnterPlanMode",
  "EnterWorktree",
  "ExitPlanMode",
  "ExitWorktree",
  "Glob",
  "Grep",
  "ListMcpResourcesTool",
  "LSP",
  "Monitor",
  "NotebookEdit",
  "PowerShell",
  "PushNotification",
  "Read",
  "ReadMcpResourceTool",
  "RemoteTrigger",
  "ReportFindings",
  "ScheduleWakeup",
  "SendMessage",
  "SendUserFile",
  "ShareOnboardingGuide",
  "Skill",
  "TaskCreate",
  "TaskGet",
  "TaskList",
  "TaskOutput",
  "TaskStop",
  "TaskUpdate",
  "TodoWrite",
  "ToolSearch",
  "WaitForMcpServers",
  "WebFetch",
  "WebSearch",
  "Workflow",
  "Write",
] as const

// pi's built-in tool set, in the order pi's own docs list them. Lower-case is
// canonical — `pi --tools read,bash`. Source: `pi --help` (v0.80).
export const PI_SPAWN_TOOLS = ["read", "bash", "edit", "write"] as const

// Canonical tool list per spawn harness — the picker renders and sorts
// against whichever list the active harness owns.
export const HARNESS_SPAWN_TOOLS: Record<"claude" | "pi", readonly string[]> = {
  claude: ALL_SPAWN_TOOLS,
  pi: PI_SPAWN_TOOLS,
}

// Toggle a tool id in/out of the current selection. The result is always
// re-sorted to canonical order (rather than insertion order) so the pill row
// never reshuffles as tools are clicked — unlike skills, tool order carries no
// meaning of its own.
export const toggleTool = ({
  selected,
  id,
  all = ALL_SPAWN_TOOLS,
}: {
  selected: readonly string[]
  id: string
  all?: readonly string[]
}): string[] => {
  const next = new Set(selected)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return all.filter((t) => next.has(t))
}

// The dispatch body only needs an explicit `tools` list once the user has
// deselected at least one — the full set is exactly the CLI's own default
// (no `--tools` flag = every built-in tool), so sending undefined keeps an
// all-selected spawn byte-identical to today's command. An empty selection is
// a deliberate "disable every tool" request and is passed through as `[]`.
export const toolsForDispatch = (
  selected: readonly string[],
  all: readonly string[] = ALL_SPAWN_TOOLS,
): readonly string[] | undefined => (selected.length === all.length ? undefined : selected)
