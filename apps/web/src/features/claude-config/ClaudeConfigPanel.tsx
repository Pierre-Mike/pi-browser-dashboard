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

  if (q.isLoading)
    return (
      <div className="flex items-center gap-2 text-sm text-base-content/60">
        <span className="loading loading-spinner loading-sm" />
        Loading…
      </div>
    )
  if (q.isError) {
    return (
      <div className="alert alert-error text-sm">
        Failed to load Claude config: {q.error instanceof Error ? q.error.message : "unknown error"}
      </div>
    )
  }
  const bundle = q.data
  if (!bundle)
    return (
      <div className="flex items-center gap-2 text-sm text-base-content/60">
        <span className="loading loading-spinner loading-sm" />
        No data
      </div>
    )

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
      <header className="flex flex-wrap items-baseline gap-2 text-xs text-base-content/60">
        <span className="font-mono">{bundle.root}</span>
        <CountChip n={bundle.hooks.length} label="hooks" />
        <CountChip n={bundle.skills.length} label="skills" />
        <CountChip n={bundle.hookScripts.length} label="scripts" />
      </header>
      {isEmpty ? (
        <div className="text-sm text-base-content/60 py-6 text-center border border-dashed border-base-300 rounded-lg bg-base-200/40">
          No Claude config found at <span className="font-mono">{bundle.root}</span>.
        </div>
      ) : null}
      <nav
        role="tablist"
        aria-label="Claude config sections"
        data-testid="claude-config-sub-tabs"
        className="flex items-center gap-1 border-b border-base-300"
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
                  ? "border-primary text-primary"
                  : "border-transparent text-base-content/60 hover:text-base-content"
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
  <span className="badge badge-sm badge-ghost gap-1 font-medium">
    <span className="font-mono tabular-nums">{n}</span>
    <span className="opacity-80">{label}</span>
  </span>
)

const eventTone: Record<string, string> = {
  Stop: "bg-success/15 text-success",
  SubagentStop: "bg-success/15 text-success",
  PreToolUse: "bg-primary/15 text-primary",
  PostToolUse: "bg-primary/15 text-primary",
  Notification: "bg-warning/15 text-warning",
  UserPromptSubmit: "bg-secondary/15 text-secondary",
  PreCompact: "bg-base-200 text-base-content",
  SessionStart: "bg-base-200 text-base-content",
  SessionEnd: "bg-base-200 text-base-content",
}

const HookCard = ({ hook }: { hook: HookEntry }) => (
  <div
    data-testid="claude-config-hook"
    className="rounded-lg border border-base-300 bg-base-100 p-2 flex flex-col gap-1 shadow-sm"
  >
    <div className="flex flex-wrap items-center gap-1.5">
      <span
        className={`text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 font-medium ${
          eventTone[hook.event] ?? "bg-base-200 text-base-content/80"
        }`}
      >
        {hook.event}
      </span>
      {hook.matcher ? (
        <span className="text-[10px] font-mono rounded bg-base-200 text-base-content/80 px-1.5 py-0.5">
          matcher: {hook.matcher}
        </span>
      ) : null}
      {hook.timeout !== undefined ? (
        <span className="text-[10px] text-base-content/60">timeout {hook.timeout}s</span>
      ) : null}
      {hook.async ? (
        <span className="text-[10px] rounded bg-secondary/15 text-secondary px-1.5 py-0.5">
          async
        </span>
      ) : null}
      {hook.statusMessage ? (
        <span className="text-[10px] italic text-base-content/60 truncate max-w-[300px]">
          "{hook.statusMessage}"
        </span>
      ) : null}
    </div>
    <pre className="text-[11px] font-mono whitespace-pre-wrap break-all bg-base-200/60 rounded p-2 max-h-32 overflow-auto">
      {hook.command}
    </pre>
  </div>
)

const HooksTab = ({ bundle }: { bundle: ScopeBundle }) => {
  if (bundle.hooks.length === 0 && bundle.hookScripts.length === 0) {
    return <div className="text-sm text-base-content/60">No hooks configured.</div>
  }
  return (
    <div className="flex flex-col gap-4">
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-base-content/60 mb-2">
          Configured hooks ({bundle.hooks.length})
        </h3>
        {bundle.hooks.length === 0 ? (
          <div className="text-sm text-base-content/60">No hooks declared in settings.json.</div>
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
          <h3 className="text-xs font-semibold uppercase tracking-wide text-base-content/60 mb-2">
            Hook scripts ({bundle.hookScripts.length})
          </h3>
          <ul className="flex flex-col gap-1">
            {bundle.hookScripts.map((s: HookScript) => (
              <li
                key={s.path}
                className="text-xs flex items-center justify-between gap-2 rounded-lg border border-base-300 bg-base-100 px-2 py-1"
              >
                <span className="font-mono">{s.name}</span>
                <span className="text-base-content/60 tabular-nums">{s.bytes} B</span>
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
  const detailQ = useSkillDetail({ scope, projectId: projectId ?? null, skillId: selected })

  if (bundle.skills.length === 0) {
    return <div className="text-sm text-base-content/60">No skills installed.</div>
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
                className={`w-full text-left text-xs rounded-lg px-2 py-1.5 border transition-colors ${
                  active
                    ? "border-primary bg-primary/10 shadow-sm"
                    : "border-base-300 hover:bg-base-200/60 hover:border-base-300"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{s.name}</span>
                  {s.hasEvals ? (
                    <span className="badge badge-sm bg-success/15 text-success border-0">
                      evals
                    </span>
                  ) : null}
                </div>
                {s.description ? (
                  <div className="text-[11px] text-base-content/60 line-clamp-2 mt-0.5">
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
          <div className="text-sm text-base-content/60 border border-dashed border-base-300 rounded-lg py-8 text-center bg-base-200/40">
            Select a skill to view its SKILL.md.
          </div>
        ) : detailQ.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-base-content/60">
            <span className="loading loading-spinner loading-sm" />
            Loading…
          </div>
        ) : detailQ.isError ? (
          <div className="alert alert-error text-sm">
            {detailQ.error instanceof Error ? detailQ.error.message : "failed"}
          </div>
        ) : detailQ.data ? (
          <article className="flex flex-col min-h-0 rounded-lg border border-base-300 bg-base-100 shadow-sm">
            <header className="flex flex-wrap items-baseline gap-2 px-3 py-2 border-b border-base-300 bg-base-200/40 rounded-t-lg">
              <h4 className="text-sm font-semibold">{detailQ.data.name}</h4>
              <span className="text-[10px] text-base-content/60 font-mono truncate">
                {detailQ.data.path}
              </span>
            </header>
            {detailQ.data.description ? (
              <p className="px-3 pt-2 text-xs text-base-content/80">{detailQ.data.description}</p>
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

const SettingsBlock = ({ title, settings }: { title: string; settings: SettingsSummary }) => (
  <section className="rounded-lg border border-base-300 overflow-hidden bg-base-100 shadow-sm">
    <header className="flex items-center justify-between px-3 py-1.5 border-b border-base-300 bg-base-200/40">
      <span className="text-xs font-semibold">{title}</span>
      {settings.parseError ? (
        <span className="badge badge-sm badge-error">parse error: {settings.parseError}</span>
      ) : null}
    </header>
    {settings.permissions ? (
      <div className="px-3 py-2 text-xs flex flex-col gap-1">
        {settings.permissions.defaultMode ? (
          <div>
            <span className="text-base-content/60">defaultMode:</span>{" "}
            <span className="font-mono">{settings.permissions.defaultMode}</span>
          </div>
        ) : null}
        {settings.permissions.allow?.length ? (
          <details>
            <summary className="cursor-pointer text-base-content/80">
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
            <summary className="cursor-pointer text-base-content/80">
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
    <details className="px-3 py-2 border-t border-base-300">
      <summary className="cursor-pointer text-xs text-base-content/80">Raw JSON</summary>
      <pre className="text-[11px] font-mono whitespace-pre-wrap break-words bg-base-200/60 rounded p-2 mt-1 max-h-80 overflow-auto">
        {settings.raw}
      </pre>
    </details>
  </section>
)

const SettingsTab = ({ bundle }: { bundle: ScopeBundle }) => {
  if (!bundle.settings && !bundle.settingsLocal) {
    return <div className="text-sm text-base-content/60">No settings.json present.</div>
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
    return <div className="text-sm text-base-content/60">No CLAUDE.md found.</div>
  }
  return (
    <div
      data-testid="claude-config-claude-md"
      className="flex-1 min-h-0 rounded-lg border border-base-300 bg-base-100 overflow-auto shadow-sm"
    >
      <MarkdownView text={bundle.claudeMd} />
    </div>
  )
}
