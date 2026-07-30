/**
 * Pure structural self-check of the enforcement stack.
 *
 * Every axiom in AGENTS.md is supposed to be enforced by a tool. Nothing was
 * checking that the *tools* are still wired: delete a lefthook job, drop a
 * biome override, rename a CI job, and the repo goes quietly green while the
 * rule it enforced evaporates. A descendant of this template lost every
 * path-scoped rule to a single app rename and nobody noticed for months.
 *
 * So: the harness checks itself. `bun run doctor` reads the config files and
 * asserts the stack's *shape* — plugins referenced and present, denials scoped
 * to file shape rather than to paths, hook jobs wired, gate scripts composed,
 * required CI contexts intact, actions pinned. Removing a gate is then a
 * deliberate, visible act that fails CI, not drift.
 *
 * Pure: file texts in, findings out. scripts/check-harness.ts does the I/O.
 */

export type Finding = { readonly check: string; readonly detail: string }

export type Workflow = { readonly name: string; readonly text: string }

export type HarnessSnapshot = {
  readonly biome: string
  readonly lefthook: string
  readonly packageJson: string
  readonly claudeMd: string
  readonly agentsMd: string
  /** .github/rulesets/main.json — the committed branch-protection contract. */
  readonly ruleset: string
  readonly gritPlugins: readonly string[]
  /** Every workspace declared in root package.json `workspaces`, expanded. */
  readonly workspaceDirs: readonly string[]
  readonly workspaceTsconfigs: readonly string[]
  readonly presentFiles: readonly string[]
  /** Every file under .github/workflows — pinning is checked across all of them. */
  readonly workflows: readonly Workflow[]
  /** Source text of gate scripts whose *shape* is asserted below. */
  readonly gateSources: Readonly<Record<string, string>>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * The status-check contexts the committed ruleset requires — or `null` when the
 * file is missing or malformed.
 *
 * A PR cannot merge unless a check with each of these names reports in, so
 * renaming a job silently makes every PR unmergeable ("base branch policy
 * prohibits the merge") even when all visible checks are green. The contexts
 * used to be a hand-maintained array here, which meant the guard was only as
 * current as someone's memory: `fallow audit (dead code)` and `Playwright` were
 * promoted in the ruleset and went unguarded for a week. Reading them from the
 * committed ruleset removes the copy that could go stale.
 *
 * `null` rather than `[]` on a bad read, because "no contexts required" is
 * indistinguishable from "any red PR can merge" and must not be inferred from a
 * typo.
 */
export const requiredContextsOf = (input: {
  readonly ruleset: string
}): readonly string[] | null => {
  let parsed: unknown
  try {
    parsed = JSON.parse(input.ruleset)
  } catch {
    return null
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.rules)) return null
  const statusRule = parsed.rules
    .filter(isRecord)
    .find((rule) => rule.type === "required_status_checks")
  const params = statusRule === undefined ? undefined : statusRule.parameters
  if (!isRecord(params) || !Array.isArray(params.required_status_checks)) return []
  return params.required_status_checks
    .filter(isRecord)
    .flatMap((check) => (typeof check.context === "string" ? [check.context] : []))
}

/**
 * Does some workflow declare a job whose display name is exactly `context`?
 *
 * A `name:` line, not a bare substring: "Playwright" also appears in step names
 * ("Install Playwright browsers"), so a substring test would keep passing after
 * the job itself was renamed — reporting green on the one thing it guards.
 */
const declaresJobNamed = (input: {
  readonly workflows: readonly Workflow[]
  readonly context: string
}): boolean => {
  const escaped = input.context.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const line = new RegExp(`^\\s*name:\\s*(['"]?)${escaped}\\1\\s*$`, "m")
  return input.workflows.some((workflow) => line.test(workflow.text))
}

export const REQUIRED_GRIT_PLUGINS: readonly string[] = [
  "no-throw-in-core.grit",
  "no-await-in-core.grit",
  "no-cast-json.grit",
  "max-one-param-declarations.grit",
]

// Globals the functional core must not touch. Scoped by shape (**/*.core.ts),
// so a new app or a renamed directory inherits the ban automatically.
export const CORE_DENIED_GLOBALS: readonly string[] = [
  "Date",
  "Promise",
  "console",
  "setTimeout",
  "setInterval",
  "process",
  "fetch",
]

const REQUIRED_LEFTHOOK_JOBS: readonly string[] = [
  "biome",
  "tdd-gate",
  "conventional-commit",
  "feature-test-floor",
  "typecheck",
  "axiom-debt",
  "unit",
]

const REQUIRED_SCRIPTS: readonly string[] = [
  "lint",
  "lint:ci",
  "typecheck",
  "test",
  "test:web",
  "test:cli",
  "test:shared",
  "test:mutation",
  "build:cli",
  "audit",
  "doctor",
  "axiom-debt",
  "axiom-debt:update",
  "scaffold:slice",
  "evals",
  "verify",
]

// Gates that must be *composed* into a command CI already runs, not merely
// present as a script somebody could forget to call.
const COMPOSED_GATES: readonly { readonly script: string; readonly needle: string }[] = [
  { script: "test", needle: "check-colocated-tests.ts" },
  { script: "test", needle: "check-harness.ts" },
  { script: "test", needle: "test:shared" },
  { script: "verify", needle: "lint:ci" },
  { script: "verify", needle: "typecheck" },
  { script: "verify", needle: "test" },
  { script: "verify", needle: "test:web" },
  { script: "verify", needle: "test:cli" },
  { script: "verify", needle: "audit" },
  { script: "verify", needle: "axiom-debt" },
]

const REQUIRED_FILES: readonly string[] = [
  ".bun-version",
  ".github/dependabot.yml",
  ".github/workflows/codeql.yml",
  ".github/workflows/evals.yml",
  ".claude/skills/add-slice/SKILL.md",
  ".claude/skills/retro/SKILL.md",
  "evals/run.sh",
  "evals/tasks.jsonl",
  "scripts/axiom-debt.json",
  "scripts/check-axiom-debt.ts",
  "scripts/check-colocated-tests.ts",
  "scripts/check-commit-msg.ts",
  "scripts/check-feature-tests.sh",
  "scripts/check-tests-touched.sh",
  "scripts/scaffold-slice.ts",
  "scripts/typecheck.ts",
  "shared/src/index.ts",
  "stryker.config.json",
]

/**
 * Gate scripts that must derive their scope from root `package.json`
 * `workspaces` rather than from a hardcoded glob.
 *
 * This check exists because of a specific near-miss: both `typecheck.ts` and
 * `check-axiom-debt.ts` originally scanned `apps/*`, so when `shared/` was
 * added as a workspace it silently escaped *both* the typecheck and the debt
 * ratchet — the first raw `fetch` written there would have been invisible.
 * A hardcoded root list fails open; deriving from the list that must already be
 * correct for `bun install` to work cannot.
 */
const WORKSPACE_DERIVED_GATES: readonly string[] = [
  "scripts/typecheck.ts",
  "scripts/check-axiom-debt.ts",
]

/**
 * The one validated reader of `workspaces` (scripts/workspaces.core.ts). Named
 * here rather than grepping for the word "workspaces" so the check asserts the
 * gate goes through the *validating* parser: a type assertion on the parsed
 * package.json also contains that word, and would satisfy a looser check while
 * silently scanning nothing once the field's shape changed.
 */
const WORKSPACE_READER = "parseWorkspacePatterns"

export const CANON_START = "<!-- CANON:START -->"
export const CANON_END = "<!-- CANON:END -->"

/** The shared canon block, or null when the markers are missing/inverted. */
export const canonBlock = (text: string): string | null => {
  const start = text.indexOf(CANON_START)
  const end = text.indexOf(CANON_END)
  if (start === -1 || end === -1 || end < start) return null
  return text.slice(start + CANON_START.length, end)
}

const UNPINNED_USES = /uses:\s*([\w.-]+\/[\w.-]+(?:\/[\w.-]+)*)@(?!\$\{)([^\s#]+)/g

/** GitHub Action refs that are not pinned to a full 40-char commit SHA. */
export const unpinnedActions = (workflow: string): readonly string[] => {
  const out: string[] = []
  for (const m of workflow.matchAll(UNPINNED_USES)) {
    const ref = m[2] ?? ""
    if (!/^[0-9a-f]{40}$/.test(ref)) out.push(`${m[1]}@${ref}`)
  }
  return out
}

// The shape of a scheduled advisory scan: a cron trigger and a `bun audit` run,
// in the SAME workflow. Matched by shape rather than by filename on purpose —
// a check for `.github/workflows/dependency-audit.yml` would go green the moment
// someone renamed or replaced the file, which is the failure mode the whole
// doctor exists to prevent. Requiring both in one file also rejects the
// accidental pass where `bun audit` sits in a PR-only workflow while some
// unrelated job supplies the cron.
const CRON_TRIGGER = /^\s*-\s*cron:/m
const BUN_AUDIT_RUN = /\bbun\s+audit\b/

export const auditHarness = (snap: HarnessSnapshot): readonly Finding[] => {
  const findings: Finding[] = []
  const miss = (finding: Finding): void => {
    findings.push(finding)
  }

  // --- Biome: plugins referenced and shipped -------------------------------
  for (const plugin of REQUIRED_GRIT_PLUGINS) {
    if (!snap.biome.includes(plugin)) {
      miss({ check: "biome-plugins", detail: `biome.json does not reference ${plugin}` })
    }
    if (!snap.gritPlugins.some((p) => p.endsWith(plugin))) {
      miss({ check: "biome-plugins", detail: `biome-plugins/${plugin} is missing from disk` })
    }
  }

  // --- Biome: denials scoped to file shape, not to a path ------------------
  if (!snap.biome.includes('"**/*.core.ts"')) {
    miss({
      check: "core-purity",
      detail: 'biome.json has no override scoped to "**/*.core.ts"',
    })
  }
  for (const global of CORE_DENIED_GLOBALS) {
    if (!snap.biome.includes(`"${global}":`)) {
      miss({
        check: "core-purity",
        detail: `the *.core.ts override does not deny the ${global} global`,
      })
    }
  }
  for (const runtime of ["Effect", "Layer", "Context"]) {
    if (!snap.biome.includes(`"${runtime}"`)) {
      miss({
        check: "core-purity",
        detail: `the *.core.ts override does not ban importing ${runtime} from effect`,
      })
    }
  }
  if (!snap.biome.includes("axios")) {
    miss({ check: "no-axios", detail: "biome.json does not ban the axios import" })
  }
  if (!snap.biome.includes('"fetch":')) {
    miss({ check: "no-raw-fetch", detail: "biome.json does not deny the fetch global" })
  }

  // --- The cast ban covers every workspace ---------------------------------
  // `no-cast-json` began scoped to apps/daemon + apps/cli + scripts, because
  // apps/web had ~40 sites awaiting a contract to decode against. Those were
  // paid off and the `json-cast` debt class was deleted — which only stays true
  // if the rule keeps covering apps/** and shared/**. Narrowing it back would
  // silently re-open a class that no ratchet is watching any more.
  const castBanCoversApps =
    /"includes":\s*\[[^\]]*"apps\/\*\*\/\*\.ts"[^\]]*\][^}]*no-cast-json\.grit/s
  if (!castBanCoversApps.test(snap.biome)) {
    miss({
      check: "no-cast-json",
      detail:
        'no-cast-json.grit is not applied to an override that includes "apps/**/*.ts" — the json-cast debt class was retired on the assumption this rule covers every workspace',
    })
  }

  // --- One parameter per declaration, scoped to the pure cores -------------
  // The plugin started life scoped to scripts/** only, which made it a rule
  // about one directory rather than about a file shape. Asserting it covers
  // "**/*.core.ts" is what keeps it a shape rule: a new slice, a new app, or a
  // renamed directory inherits it without anyone editing an includes list.
  const coreOneParamScoped =
    /"includes":\s*\[[^\]]*"\*\*\/\*\.core\.ts"[^\]]*\][^}]*max-one-param-declarations\.grit/s
  if (!coreOneParamScoped.test(snap.biome)) {
    miss({
      check: "one-param",
      detail:
        'max-one-param-declarations.grit is not applied to an override that includes "**/*.core.ts" — it would only be a rule about one directory, not about the pure cores',
    })
  }

  // --- Lefthook: every gate still wired -----------------------------------
  for (const job of REQUIRED_LEFTHOOK_JOBS) {
    if (!snap.lefthook.includes(`name: ${job}`)) {
      miss({ check: "lefthook", detail: `lefthook.yml has no "${job}" job` })
    }
  }

  // --- package.json: scripts present and gates composed -------------------
  let scripts: Record<string, string> = {}
  try {
    const parsed = JSON.parse(snap.packageJson) as { scripts?: Record<string, string> }
    scripts = parsed.scripts ?? {}
  } catch {
    miss({ check: "package.json", detail: "package.json is not valid JSON" })
  }
  for (const name of REQUIRED_SCRIPTS) {
    if (scripts[name] === undefined)
      miss({ check: "scripts", detail: `package.json has no "${name}" script` })
  }
  for (const gate of COMPOSED_GATES) {
    const body = scripts[gate.script]
    if (body !== undefined && !body.includes(gate.needle)) {
      miss({
        check: "scripts",
        detail: `the "${gate.script}" script no longer runs ${gate.needle}`,
      })
    }
  }

  // --- CI: the ruleset's required contexts all report -----------------------
  // The contexts come from the committed ruleset, not a list maintained here.
  // Each is then looked for across EVERY workflow, discovered from disk — same
  // reasoning as pinning below. `Playwright` is required and declared in
  // pr-e2e.yml, and the next check someone promotes could live in a file that
  // does not exist yet; scanning one hardcoded workflow would miss both.
  const contexts = requiredContextsOf({ ruleset: snap.ruleset })
  if (contexts === null) {
    miss({
      check: "governance",
      detail:
        ".github/rulesets/main.json is missing or not valid JSON — branch protection has no committed contract, so nothing can check the CI jobs against it",
    })
  } else if (contexts.length === 0) {
    miss({
      check: "governance",
      detail:
        "the committed ruleset requires no status checks — a red PR could merge; restore required_status_checks in .github/rulesets/main.json",
    })
  }
  for (const context of contexts ?? []) {
    if (!declaresJobNamed({ workflows: snap.workflows, context })) {
      miss({
        check: "ci-contexts",
        detail: `the ruleset requires check "${context}" but no workflow declares a job with that name — PRs would never become mergeable. Rename the job and the ruleset context TOGETHER.`,
      })
    }
  }
  // Pinning is checked across EVERY workflow, discovered from disk, not just
  // the one CI file. A tag or branch ref is mutable: whoever controls it can
  // change what runs in a workflow that already has a token. Checking one file
  // would let the next added workflow skip the rule entirely.
  if (snap.workflows.length === 0) {
    miss({ check: "action-pinning", detail: "no workflows found under .github/workflows" })
  }
  for (const workflow of snap.workflows) {
    for (const ref of unpinnedActions(workflow.text)) {
      miss({
        check: "action-pinning",
        detail: `${workflow.name} uses ${ref} — pin actions to a full commit SHA`,
      })
    }
  }

  // --- Docs: the canon block is present and identical in both files -------
  const claude = canonBlock(snap.claudeMd)
  const agents = canonBlock(snap.agentsMd)
  if (claude === null)
    miss({ check: "canon", detail: "CLAUDE.md has no CANON:START/CANON:END block" })
  if (agents === null)
    miss({ check: "canon", detail: "AGENTS.md has no CANON:START/CANON:END block" })
  if (claude !== null && agents !== null && claude !== agents) {
    miss({ check: "canon", detail: "the CLAUDE.md and AGENTS.md canon blocks have drifted apart" })
  }

  // --- Typecheck coverage: no workspace outside the gate ------------------
  // `workspaceDirs` covers every entry in root `workspaces`, so `shared/` — a
  // workspace that is not an app — is included. An earlier `apps/*` scan here
  // would have declared the stack intact while shared/ went unchecked.
  for (const dir of snap.workspaceDirs) {
    if (!snap.workspaceTsconfigs.includes(`${dir}/tsconfig.json`)) {
      miss({
        check: "typecheck",
        detail: `${dir} is a workspace with no tsconfig.json, so it escapes the typecheck gate`,
      })
    }
  }

  // --- Gate scope derives from `workspaces`, not a hardcoded glob ----------
  for (const gate of WORKSPACE_DERIVED_GATES) {
    const source = snap.gateSources[gate]
    if (source === undefined) {
      miss({ check: "gate-scope", detail: `${gate} could not be read` })
      continue
    }
    if (!source.includes(WORKSPACE_READER)) {
      miss({
        check: "gate-scope",
        detail: `${gate} no longer derives its scope through ${WORKSPACE_READER}() — a hardcoded root list fails open, exempting the next workspace someone adds`,
      })
    }
  }

  // --- Gate scripts still on disk ----------------------------------------
  for (const file of REQUIRED_FILES) {
    if (!snap.presentFiles.includes(file)) miss({ check: "files", detail: `${file} is missing` })
  }

  // --- Advisories are scanned on a clock, not on push traffic --------------
  // Every other dependency signal here is event-driven, so a repo nobody is
  // pushing to is a repo nobody is scanning — and a new advisory is an event in
  // the world, not in this repo. The template upstream went 2.5 quiet weeks and
  // accumulated 16 advisories, one critical, before a routine PR tripped over
  // them.
  const scansOnAClock = snap.workflows.some(
    (workflow) => CRON_TRIGGER.test(workflow.text) && BUN_AUDIT_RUN.test(workflow.text),
  )
  if (!scansOnAClock) {
    miss({
      check: "scheduled-audit",
      detail:
        "no workflow runs `bun audit` on a cron — advisories would only surface when someone happens to open a PR, so a quiet repo becomes a blind one",
    })
  }

  return findings
}
