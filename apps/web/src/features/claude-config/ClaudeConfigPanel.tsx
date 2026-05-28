import { useState } from "react"
import { MarkdownView } from "../projects/MarkdownView"
import type { HookEntry, HookScript, ScopeBundle, SettingsSummary, SkillSummary } from "./types"
import { useGlobalClaudeConfig, useProjectClaudeConfig, useSkillDetail } from "./useClaudeConfig"

type Props =
  | { readonly scope: "global"; readonly projectId?: undefined }
  | { readonly scope: "project"; readonly projectId: string }

type Sub = "hooks" | "skills" | "settings" | "claude-md"

const SUB_TABS: readonly { key: Sub; label: string }[] = [
  { key: "hooks", label: "Hooks" },
  { key: "skills", label: "Skills" },
  { key: "settings", label: "Settings" },
  { key: "claude-md", label: "CLAUDE.md" },
]

export const ClaudeConfigPanel = (props: Props) => {
  const isGlobal = props.scope === "global"
  const globalQ = useGlobalClaudeConfig()
  const projectQ = useProjectClaudeConfig(isGlobal ? "" : props.projectId)
  const q = isGlobal ? globalQ : projectQ
  const [sub, setSub] = useState<Sub>("hooks")

  if (q.isLoading) return <div className="text-sm text-slate-500">Loading…</div>
  if (q.isError) {
    return (
      <div className="text-sm text-rose-600">
        Failed to load Claude config: {q.error instanceof Error ? q.error.message : "unknown error"}
      </div>
    )
  }
  const bundle = q.data
  if (!bundle) return <div className="text-sm text-slate-500">No data</div>

  const isEmpty =
    bundle.hooks.length === 0 &&
    bundle.hookScripts.length === 0 &&
    bundle.skills.length === 0 &&
    !bundle.settings &&
    !bundle.settingsLocal &&
    !bundle.claudeMd

  return (
    <div
      data-testid={`claude-config-panel-${bundle.scope}`}
      className="flex flex-col flex-1 min-h-0 gap-3"
    >
      <header className="flex flex-wrap items-baseline gap-2 text-xs text-slate-500 dark:text-slate-400">
        <span className="font-mono">{bundle.root}</span>
        <CountChip n={bundle.hooks.length} label="hooks" />
        <CountChip n={bundle.skills.length} label="skills" />
        <CountChip n={bundle.hookScripts.length} label="scripts" />
      </header>
      {isEmpty ? (
        <div className="text-sm text-slate-500 dark:text-slate-400 py-6 text-center border border-dashed border-slate-300 dark:border-slate-800 rounded-lg">
          No Claude config found at <span className="font-mono">{bundle.root}</span>.
        </div>
      ) : null}
      <nav
        role="tablist"
        aria-label="Claude config sections"
        data-testid="claude-config-sub-tabs"
        className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-800"
      >
        {SUB_TABS.map((t) => {
          const active = sub === t.key
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`claude-config-sub-tab-${t.key}`}
              data-active={active}
              onClick={() => setSub(t.key)}
              className={`px-3 py-1 text-xs font-medium border-b-2 -mb-px transition-colors ${
                active
                  ? "border-sky-500 text-sky-700 dark:text-sky-300"
                  : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
              }`}
            >
              {t.label}
            </button>
          )
        })}
      </nav>
      <div className={sub === "hooks" ? "flex-1 min-h-0 overflow-auto" : "hidden"}>
        <HooksTab bundle={bundle} />
      </div>
      <div className={sub === "skills" ? "flex-1 min-h-0 flex flex-col" : "hidden"}>
        <SkillsTab
          bundle={bundle}
          {...(props.scope === "project" ? { projectId: props.projectId } : {})}
        />
      </div>
      <div className={sub === "settings" ? "flex-1 min-h-0 overflow-auto" : "hidden"}>
        <SettingsTab bundle={bundle} />
      </div>
      <div className={sub === "claude-md" ? "flex-1 min-h-0 flex flex-col" : "hidden"}>
        <ClaudeMdTab bundle={bundle} />
      </div>
    </div>
  )
}

const CountChip = ({ n, label }: { n: number; label: string }) => (
  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 font-medium">
    <span className="font-mono tabular-nums">{n}</span>
    <span className="opacity-80">{label}</span>
  </span>
)

const eventTone: Record<string, string> = {
  Stop: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200",
  SubagentStop: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200",
  PreToolUse: "bg-sky-100 dark:bg-sky-900/40 text-sky-800 dark:text-sky-200",
  PostToolUse: "bg-sky-100 dark:bg-sky-900/40 text-sky-800 dark:text-sky-200",
  Notification: "bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200",
  UserPromptSubmit: "bg-violet-100 dark:bg-violet-900/40 text-violet-800 dark:text-violet-200",
  PreCompact: "bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200",
  SessionStart: "bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200",
  SessionEnd: "bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200",
}

const HookCard = ({ hook }: { hook: HookEntry }) => (
  <div
    data-testid="claude-config-hook"
    className="rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2 flex flex-col gap-1"
  >
    <div className="flex flex-wrap items-center gap-1.5">
      <span
        className={`text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 font-medium ${
          eventTone[hook.event] ??
          "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
        }`}
      >
        {hook.event}
      </span>
      {hook.matcher ? (
        <span className="text-[10px] font-mono rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-1.5 py-0.5">
          matcher: {hook.matcher}
        </span>
      ) : null}
      {hook.timeout !== undefined ? (
        <span className="text-[10px] text-slate-500">timeout {hook.timeout}s</span>
      ) : null}
      {hook.async ? (
        <span className="text-[10px] rounded bg-violet-100 dark:bg-violet-900/40 text-violet-800 dark:text-violet-200 px-1.5 py-0.5">
          async
        </span>
      ) : null}
      {hook.statusMessage ? (
        <span className="text-[10px] italic text-slate-500 truncate max-w-[300px]">
          “{hook.statusMessage}”
        </span>
      ) : null}
    </div>
    <pre className="text-[11px] font-mono whitespace-pre-wrap break-all bg-slate-50 dark:bg-slate-950/60 rounded p-2 max-h-32 overflow-auto">
      {hook.command}
    </pre>
  </div>
)

const HooksTab = ({ bundle }: { bundle: ScopeBundle }) => {
  if (bundle.hooks.length === 0 && bundle.hookScripts.length === 0) {
    return <div className="text-sm text-slate-500">No hooks configured.</div>
  }
  return (
    <div className="flex flex-col gap-4">
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
          Configured hooks ({bundle.hooks.length})
        </h3>
        {bundle.hooks.length === 0 ? (
          <div className="text-sm text-slate-500">No hooks declared in settings.json.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {bundle.hooks.map((h, i) => (
              <HookCard key={`${h.event}-${i}`} hook={h} />
            ))}
          </div>
        )}
      </section>
      {bundle.hookScripts.length > 0 ? (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
            Hook scripts ({bundle.hookScripts.length})
          </h3>
          <ul className="flex flex-col gap-1">
            {bundle.hookScripts.map((s: HookScript) => (
              <li
                key={s.path}
                className="text-xs flex items-center justify-between gap-2 rounded border border-slate-200 dark:border-slate-800 px-2 py-1"
              >
                <span className="font-mono">{s.name}</span>
                <span className="text-slate-500 tabular-nums">{s.bytes} B</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

type SkillsTabProps = { bundle: ScopeBundle; projectId?: string }

const SkillsTab = ({ bundle, projectId }: SkillsTabProps) => {
  const [selected, setSelected] = useState<string | null>(null)
  const scope = bundle.scope
  const detailQ = useSkillDetail(scope, projectId ?? null, selected)

  if (bundle.skills.length === 0) {
    return <div className="text-sm text-slate-500">No skills installed.</div>
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 flex-1 min-h-0">
      <ul className="md:col-span-1 flex flex-col gap-1 min-h-0 overflow-auto pr-1">
        {bundle.skills.map((s: SkillSummary) => {
          const active = selected === s.id
          return (
            <li key={s.id}>
              <button
                type="button"
                data-testid={`claude-config-skill-${s.id}`}
                onClick={() => setSelected(s.id)}
                className={`w-full text-left text-xs rounded px-2 py-1.5 border ${
                  active
                    ? "border-sky-400 bg-sky-50 dark:bg-sky-950/40 dark:border-sky-700"
                    : "border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{s.name}</span>
                  {s.hasEvals ? (
                    <span className="text-[9px] uppercase tracking-wide rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200 px-1 py-0.5">
                      evals
                    </span>
                  ) : null}
                </div>
                {s.description ? (
                  <div className="text-[11px] text-slate-500 line-clamp-2 mt-0.5">
                    {s.description}
                  </div>
                ) : null}
              </button>
            </li>
          )
        })}
      </ul>
      <div className="md:col-span-2 flex flex-col min-h-0">
        {selected === null ? (
          <div className="text-sm text-slate-500 border border-dashed border-slate-300 dark:border-slate-800 rounded-lg py-8 text-center">
            Select a skill to view its SKILL.md.
          </div>
        ) : detailQ.isLoading ? (
          <div className="text-sm text-slate-500">Loading…</div>
        ) : detailQ.isError ? (
          <div className="text-sm text-rose-600">
            {detailQ.error instanceof Error ? detailQ.error.message : "failed"}
          </div>
        ) : detailQ.data ? (
          <article className="flex flex-col min-h-0 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <header className="flex flex-wrap items-baseline gap-2 px-3 py-2 border-b border-slate-200 dark:border-slate-800">
              <h4 className="text-sm font-semibold">{detailQ.data.name}</h4>
              <span className="text-[10px] text-slate-500 font-mono truncate">
                {detailQ.data.path}
              </span>
            </header>
            {detailQ.data.description ? (
              <p className="px-3 pt-2 text-xs text-slate-600 dark:text-slate-400">
                {detailQ.data.description}
              </p>
            ) : null}
            <div data-testid="claude-config-skill-body" className="flex-1 min-h-0 overflow-auto">
              <MarkdownView text={detailQ.data.body} />
            </div>
          </article>
        ) : null}
      </div>
    </div>
  )
}

const SettingsBlock = ({
  title,
  settings,
}: {
  title: string
  settings: SettingsSummary
}) => (
  <section className="rounded-md border border-slate-200 dark:border-slate-800 overflow-hidden">
    <header className="flex items-center justify-between px-3 py-1.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900">
      <span className="text-xs font-semibold">{title}</span>
      {settings.parseError ? (
        <span className="text-[10px] text-rose-600">parse error: {settings.parseError}</span>
      ) : null}
    </header>
    {settings.permissions ? (
      <div className="px-3 py-2 text-xs flex flex-col gap-1">
        {settings.permissions.defaultMode ? (
          <div>
            <span className="text-slate-500">defaultMode:</span>{" "}
            <span className="font-mono">{settings.permissions.defaultMode}</span>
          </div>
        ) : null}
        {settings.permissions.allow?.length ? (
          <details>
            <summary className="cursor-pointer text-slate-600 dark:text-slate-400">
              allow ({settings.permissions.allow.length})
            </summary>
            <ul className="font-mono text-[11px] pl-3 pt-1 max-h-40 overflow-auto">
              {settings.permissions.allow.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </details>
        ) : null}
        {settings.permissions.deny?.length ? (
          <details>
            <summary className="cursor-pointer text-slate-600 dark:text-slate-400">
              deny ({settings.permissions.deny.length})
            </summary>
            <ul className="font-mono text-[11px] pl-3 pt-1 max-h-40 overflow-auto">
              {settings.permissions.deny.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    ) : null}
    <details className="px-3 py-2 border-t border-slate-200 dark:border-slate-800">
      <summary className="cursor-pointer text-xs text-slate-600 dark:text-slate-400">
        Raw JSON
      </summary>
      <pre className="text-[11px] font-mono whitespace-pre-wrap break-words bg-slate-50 dark:bg-slate-950/60 rounded p-2 mt-1 max-h-80 overflow-auto">
        {settings.raw}
      </pre>
    </details>
  </section>
)

const SettingsTab = ({ bundle }: { bundle: ScopeBundle }) => {
  if (!bundle.settings && !bundle.settingsLocal) {
    return <div className="text-sm text-slate-500">No settings.json present.</div>
  }
  return (
    <div className="flex flex-col gap-3">
      {bundle.settings ? <SettingsBlock title="settings.json" settings={bundle.settings} /> : null}
      {bundle.settingsLocal ? (
        <SettingsBlock title="settings.local.json" settings={bundle.settingsLocal} />
      ) : null}
    </div>
  )
}

const ClaudeMdTab = ({ bundle }: { bundle: ScopeBundle }) => {
  if (!bundle.claudeMd) {
    return <div className="text-sm text-slate-500">No CLAUDE.md found.</div>
  }
  return (
    <div
      data-testid="claude-config-claude-md"
      className="flex-1 min-h-0 rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-auto"
    >
      <MarkdownView text={bundle.claudeMd} />
    </div>
  )
}
