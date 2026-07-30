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
  /** Raw evals/tasks.jsonl — one JSON task per line. See `tasksMissingAsserts`. */
  readonly evalTasks: string
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
  // The graded eval grid: the agent-facing half of the harness. `evals:baseline`
  // is the one that keeps the grid honest — it scores every task with NO agent,
  // so a task that a do-nothing run already passes is visible for free.
  "test:evals",
  "evals:baseline",
  "evals:report",
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
  // The eval harness's own pure cores (scoring, probe judgements, gate
  // derivation) are unit-tested like any other core — the harness that judges
  // the agent is judged by the repo's own gates.
  { script: "test", needle: "test:evals" },
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
  // The offline half of the ruleset contract is this checker; the online half
  // is the drift comparison. Tracked by path so renaming it fails loudly here
  // rather than quietly satisfying the shape check with a dangling reference.
  "scripts/check-ruleset-drift.ts",
  "scripts/ruleset-drift.core.ts",
  "scripts/scaffold-slice.ts",
  "scripts/typecheck.ts",
  "shared/src/index.ts",
  "stryker.config.json",
  // The graded grid, not just the task list: a runner, a functional probe, a
  // report with the A/B verdict, and the pure scorer they share.
  "evals/run.ts",
  "evals/probe.ts",
  "evals/report.ts",
  "evals/score.core.ts",
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

export type EvalTaskProblem = { readonly label: string; readonly reason: string }

/**
 * Eval tasks that hand out free points, or lines that are not tasks at all.
 *
 * The grid's gate jury (`bun run verify`) is green on an untouched checkout, so
 * a task judged by the gates alone scores an agent that did *nothing* a perfect
 * 1.0 — which is exactly what the stub eval this replaced did. A task's own
 * `asserts` are the only jury that can tell those apart, so a task without at
 * least one is not a weak measurement, it is no measurement. Nobody notices
 * that by reading the file; a gate does.
 *
 * Parses rather than greps: a task list that stopped being valid JSONL would
 * make the runner throw at cell 1 of 36, hours into a paid grid.
 */
const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const parsedLine = (line: string): unknown => {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

/** A task's own id when it has one, else the line it came in on. */
const taskLabel = (input: {
  readonly task: Record<string, unknown>
  readonly index: number
}): string =>
  typeof input.task.id === "string" && input.task.id.length > 0
    ? input.task.id
    : `line ${input.index + 1}`

const carriesAnAssert = (task: Record<string, unknown>): boolean =>
  Array.isArray(task.asserts) && task.asserts.length > 0

const taskProblem = (input: {
  readonly line: string
  readonly index: number
}): readonly EvalTaskProblem[] => {
  const task = parsedLine(input.line)
  if (!isJsonObject(task)) {
    return [{ label: `line ${input.index + 1}`, reason: "is not a JSON object" }]
  }
  return carriesAnAssert(task)
    ? []
    : [
        {
          label: taskLabel({ task, index: input.index }),
          reason: "has no asserts, so the repo gates alone would score it",
        },
      ]
}

export const tasksMissingAsserts = (input: {
  readonly jsonl: string
}): readonly EvalTaskProblem[] => {
  const lines = input.jsonl.split("\n").filter((line) => line.trim().length > 0)
  if (lines.length === 0) {
    return [{ label: "evals/tasks.jsonl", reason: "declares no tasks at all" }]
  }
  return lines.flatMap((line, index) => taskProblem({ line, index }))
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

// The shape of the ruleset-drift watch, by the same rule and for the same
// reason: a cron trigger and a run of the drift comparison, in the SAME
// workflow. Named by the script it must invoke rather than by the workflow's
// filename, so renaming the workflow keeps the check honest while deleting the
// comparison — or moving the cron into a different file — fails it.
const RULESET_DRIFT_RUN = /\bcheck-ruleset-drift\b/

/**
 * One exported function per check, and `auditHarness` is the spread of their
 * results.
 *
 * This was a single function until four branches appended a section each and it
 * reached 250 lines at 44 cyclomatic — which fallow rates CRITICAL, and which
 * stayed green only because the audit gate treated it as an inherited finding. A
 * checker nobody can read is a poor advertisement for a repo whose argument is
 * that complexity gets caught. The split also lets a red-team test call the one
 * check it is about instead of filtering a combined findings list.
 *
 * Order matters: the spread reproduces the original section order, so anything
 * comparing whole findings lists sees no drift.
 */

// --- Biome: plugins referenced and shipped ----------------------------------

export const checkGritPlugins = (snap: HarnessSnapshot): readonly Finding[] =>
  REQUIRED_GRIT_PLUGINS.flatMap((plugin) => [
    ...(snap.biome.includes(plugin)
      ? []
      : [{ check: "biome-plugins", detail: `biome.json does not reference ${plugin}` }]),
    ...(snap.gritPlugins.some((p) => p.endsWith(plugin))
      ? []
      : [{ check: "biome-plugins", detail: `biome-plugins/${plugin} is missing from disk` }]),
  ])

// --- Biome: denials scoped to file shape, not to a path ---------------------

const coreOverrideScoped = (snap: HarnessSnapshot): readonly Finding[] =>
  snap.biome.includes('"**/*.core.ts"')
    ? []
    : [{ check: "core-purity", detail: 'biome.json has no override scoped to "**/*.core.ts"' }]

const undeniedGlobals = (snap: HarnessSnapshot): readonly Finding[] =>
  CORE_DENIED_GLOBALS.filter((global) => !snap.biome.includes(`"${global}":`)).map((global) => ({
    check: "core-purity",
    detail: `the *.core.ts override does not deny the ${global} global`,
  }))

const unbannedRuntimeImports = (snap: HarnessSnapshot): readonly Finding[] =>
  ["Effect", "Layer", "Context"]
    .filter((runtime) => !snap.biome.includes(`"${runtime}"`))
    .map((runtime) => ({
      check: "core-purity",
      detail: `the *.core.ts override does not ban importing ${runtime} from effect`,
    }))

export const checkCorePurity = (snap: HarnessSnapshot): readonly Finding[] => [
  ...coreOverrideScoped(snap),
  ...undeniedGlobals(snap),
  ...unbannedRuntimeImports(snap),
  ...(snap.biome.includes("axios")
    ? []
    : [{ check: "no-axios", detail: "biome.json does not ban the axios import" }]),
  ...(snap.biome.includes('"fetch":')
    ? []
    : [{ check: "no-raw-fetch", detail: "biome.json does not deny the fetch global" }]),
]

// --- The cast ban covers every workspace -----------------------------------
// `no-cast-json` began scoped to apps/daemon + apps/cli + scripts, because
// apps/web had ~40 sites awaiting a contract to decode against. Those were
// paid off and the `json-cast` debt class was deleted — which only stays true
// if the rule keeps covering apps/** and shared/**. Narrowing it back would
// silently re-open a class that no ratchet is watching any more.

const CAST_BAN_COVERS_APPS =
  /"includes":\s*\[[^\]]*"apps\/\*\*\/\*\.ts"[^\]]*\][^}]*no-cast-json\.grit/s

export const checkCastBan = (snap: HarnessSnapshot): readonly Finding[] =>
  CAST_BAN_COVERS_APPS.test(snap.biome)
    ? []
    : [
        {
          check: "no-cast-json",
          detail:
            'no-cast-json.grit is not applied to an override that includes "apps/**/*.ts" — the json-cast debt class was retired on the assumption this rule covers every workspace',
        },
      ]

// --- One parameter per declaration, scoped to the pure cores ---------------
// The plugin started life scoped to scripts/** only, which made it a rule
// about one directory rather than about a file shape. Asserting it covers
// "**/*.core.ts" is what keeps it a shape rule: a new slice, a new app, or a
// renamed directory inherits it without anyone editing an includes list.

const CORE_ONE_PARAM_SCOPED =
  /"includes":\s*\[[^\]]*"\*\*\/\*\.core\.ts"[^\]]*\][^}]*max-one-param-declarations\.grit/s

export const checkOneParam = (snap: HarnessSnapshot): readonly Finding[] =>
  CORE_ONE_PARAM_SCOPED.test(snap.biome)
    ? []
    : [
        {
          check: "one-param",
          detail:
            'max-one-param-declarations.grit is not applied to an override that includes "**/*.core.ts" — it would only be a rule about one directory, not about the pure cores',
        },
      ]

// --- A pure core may not import a published door ---------------------------
// A `<feature>.door.ts` re-exports its slice's service `Context.Tag`, so a
// core importing one pulls the Effect runtime in by a route the direct ban on
// `effect` cannot see: the import specifier says `../projects/projects.door`,
// not `effect`. The door is also the one cross-slice path the debt ratchet
// leaves open, which is exactly why the core needs its own ban — the
// sanctioned path must not become the pure layer's loophole.
//
// Matched inside the override scoped by SHAPE (`**/*.core.ts`) rather than
// anywhere in the file: a door ban parked in a path-scoped override would
// stop applying the next time an app is renamed, which is the failure this
// whole checker exists to prevent. The body runs to the *next* `"includes"`,
// which is where the next override starts.
//
// And it must appear in a `"group"` array, not merely somewhere in the body.
// The first draft of this check searched the body for `*.door` and passed
// after the pattern had been deleted, because the rule's own explanatory
// `"message"` still said the words `*.door.ts` — a checker satisfied by prose
// about a rule instead of the rule.

const CORE_OVERRIDE_BODY =
  /"includes":\s*\[[^\]]*"\*\*\/\*\.core\.ts"[^\]]*\]((?:(?!"includes")[\s\S])*)/
const DOOR_BAN_GROUP = /"group":\s*\[[^\]]*\*\.door/

export const checkCoreDoorBan = (snap: HarnessSnapshot): readonly Finding[] =>
  DOOR_BAN_GROUP.test(CORE_OVERRIDE_BODY.exec(snap.biome)?.[1] ?? "")
    ? []
    : [
        {
          check: "core-purity",
          detail:
            'the "**/*.core.ts" override does not ban importing a published door (*.door) — a door re-exports a service Context.Tag, so the pure core could pull the Effect runtime in through it',
        },
      ]

// --- Lefthook: every gate still wired --------------------------------------

export const checkLefthook = (snap: HarnessSnapshot): readonly Finding[] =>
  REQUIRED_LEFTHOOK_JOBS.filter((job) => !snap.lefthook.includes(`name: ${job}`)).map((job) => ({
    check: "lefthook",
    detail: `lefthook.yml has no "${job}" job`,
  }))

// --- package.json: scripts present and gates composed ----------------------

/** The scripts block, or null when package.json will not parse at all. */
const scriptsOf = (packageJson: string): Readonly<Record<string, string>> | null => {
  try {
    const parsed: unknown = JSON.parse(packageJson)
    if (!isRecord(parsed) || !isRecord(parsed.scripts)) return {}
    return Object.fromEntries(
      Object.entries(parsed.scripts).flatMap(([name, body]) =>
        typeof body === "string" ? [[name, body]] : [],
      ),
    )
  } catch {
    return null
  }
}

const missingScripts = (scripts: Readonly<Record<string, string>>): readonly Finding[] =>
  REQUIRED_SCRIPTS.filter((name) => scripts[name] === undefined).map((name) => ({
    check: "scripts",
    detail: `package.json has no "${name}" script`,
  }))

export const checkScripts = (snap: HarnessSnapshot): readonly Finding[] => {
  const scripts = scriptsOf(snap.packageJson)
  // Unparseable package.json: report that, and every required script as missing
  // — which is what the single-function version did by falling through with an
  // empty scripts map.
  if (scripts === null) {
    return [
      { check: "package.json", detail: "package.json is not valid JSON" },
      ...missingScripts({}),
    ]
  }
  return [
    ...missingScripts(scripts),
    ...COMPOSED_GATES.filter((gate) => {
      const body = scripts[gate.script]
      return body !== undefined && !body.includes(gate.needle)
    }).map((gate) => ({
      check: "scripts",
      detail: `the "${gate.script}" script no longer runs ${gate.needle}`,
    })),
  ]
}

// --- CI: the ruleset's required contexts all report ------------------------
// The contexts come from the committed ruleset, not a list maintained here.
// Each is then looked for across EVERY workflow, discovered from disk — same
// reasoning as pinning below. `Playwright` is required and declared in
// pr-e2e.yml, and the next check someone promotes could live in a file that
// does not exist yet; scanning one hardcoded workflow would miss both.

const governanceGap = (contexts: readonly string[] | null): readonly Finding[] => {
  if (contexts === null) {
    return [
      {
        check: "governance",
        detail:
          ".github/rulesets/main.json is missing or not valid JSON — branch protection has no committed contract, so nothing can check the CI jobs against it",
      },
    ]
  }
  return contexts.length === 0
    ? [
        {
          check: "governance",
          detail:
            "the committed ruleset requires no status checks — a red PR could merge; restore required_status_checks in .github/rulesets/main.json",
        },
      ]
    : []
}

export const checkCiContexts = (snap: HarnessSnapshot): readonly Finding[] => {
  const contexts = requiredContextsOf({ ruleset: snap.ruleset })
  return [
    ...governanceGap(contexts),
    ...(contexts ?? [])
      .filter((context) => !declaresJobNamed({ workflows: snap.workflows, context }))
      .map((context) => ({
        check: "ci-contexts",
        detail: `the ruleset requires check "${context}" but no workflow declares a job with that name — PRs would never become mergeable. Rename the job and the ruleset context TOGETHER.`,
      })),
  ]
}

// --- Actions pinned to a commit SHA, across every workflow -----------------
// Pinning is checked across EVERY workflow, discovered from disk, not just
// the one CI file. A tag or branch ref is mutable: whoever controls it can
// change what runs in a workflow that already has a token. Checking one file
// would let the next added workflow skip the rule entirely.

export const checkActionPinning = (snap: HarnessSnapshot): readonly Finding[] => [
  ...(snap.workflows.length === 0
    ? [{ check: "action-pinning", detail: "no workflows found under .github/workflows" }]
    : []),
  ...snap.workflows.flatMap((workflow) =>
    unpinnedActions(workflow.text).map((ref) => ({
      check: "action-pinning",
      detail: `${workflow.name} uses ${ref} — pin actions to a full commit SHA`,
    })),
  ),
]

// --- Docs: the canon block is present and identical in both files ----------

const missingCanonBlock = (input: {
  readonly file: string
  readonly block: string | null
}): readonly Finding[] =>
  input.block === null
    ? [{ check: "canon", detail: `${input.file} has no CANON:START/CANON:END block` }]
    : []

const canonDrift = (input: {
  readonly claude: string | null
  readonly agents: string | null
}): readonly Finding[] =>
  input.claude !== null && input.agents !== null && input.claude !== input.agents
    ? [{ check: "canon", detail: "the CLAUDE.md and AGENTS.md canon blocks have drifted apart" }]
    : []

export const checkCanonSync = (snap: HarnessSnapshot): readonly Finding[] => {
  const claude = canonBlock(snap.claudeMd)
  const agents = canonBlock(snap.agentsMd)
  return [
    ...missingCanonBlock({ file: "CLAUDE.md", block: claude }),
    ...missingCanonBlock({ file: "AGENTS.md", block: agents }),
    ...canonDrift({ claude, agents }),
  ]
}

// --- Typecheck coverage: no workspace outside the gate ---------------------
// `workspaceDirs` covers every entry in root `workspaces`, so `shared/` — a
// workspace that is not an app — is included. An earlier `apps/*` scan here
// would have declared the stack intact while shared/ went unchecked.

export const checkTypecheckCoverage = (snap: HarnessSnapshot): readonly Finding[] =>
  snap.workspaceDirs
    .filter((dir) => !snap.workspaceTsconfigs.includes(`${dir}/tsconfig.json`))
    .map((dir) => ({
      check: "typecheck",
      detail: `${dir} is a workspace with no tsconfig.json, so it escapes the typecheck gate`,
    }))

// --- Gate scope derives from `workspaces`, not a hardcoded glob ------------

const gateScopeGap = (input: {
  readonly gate: string
  readonly source: string | undefined
}): readonly Finding[] => {
  if (input.source === undefined) {
    return [{ check: "gate-scope", detail: `${input.gate} could not be read` }]
  }
  return input.source.includes(WORKSPACE_READER)
    ? []
    : [
        {
          check: "gate-scope",
          detail: `${input.gate} no longer derives its scope through ${WORKSPACE_READER}() — a hardcoded root list fails open, exempting the next workspace someone adds`,
        },
      ]
}

export const checkGateScope = (snap: HarnessSnapshot): readonly Finding[] =>
  WORKSPACE_DERIVED_GATES.flatMap((gate) => gateScopeGap({ gate, source: snap.gateSources[gate] }))

// --- Gate scripts still on disk -------------------------------------------

export const checkRequiredFiles = (snap: HarnessSnapshot): readonly Finding[] =>
  REQUIRED_FILES.filter((file) => !snap.presentFiles.includes(file)).map((file) => ({
    check: "files",
    detail: `${file} is missing`,
  }))

// --- Every eval task carries at least one assert ---------------------------

export const checkEvalTasks = (snap: HarnessSnapshot): readonly Finding[] =>
  tasksMissingAsserts({ jsonl: snap.evalTasks }).map((problem) => ({
    check: "eval-tasks",
    detail: `evals/tasks.jsonl: ${problem.label} ${problem.reason} — add a functional assert (see evals/README.md), the gates are green on an untouched checkout`,
  }))

// --- Advisories are scanned on a clock, not on push traffic ---------------
// Every other dependency signal here is event-driven, so a repo nobody is
// pushing to is a repo nobody is scanning — and a new advisory is an event in
// the world, not in this repo. The template upstream went 2.5 quiet weeks and
// accumulated 16 advisories, one critical, before a routine PR tripped over
// them.

export const checkScheduledAudit = (snap: HarnessSnapshot): readonly Finding[] =>
  snap.workflows.some(
    (workflow) => CRON_TRIGGER.test(workflow.text) && BUN_AUDIT_RUN.test(workflow.text),
  )
    ? []
    : [
        {
          check: "scheduled-audit",
          detail:
            "no workflow runs `bun audit` on a cron — advisories would only surface when someone happens to open a PR, so a quiet repo becomes a blind one",
        },
      ]

// --- The committed ruleset is reconciled against the live one, on a clock ---
// This checker validates `.github/rulesets/main.json` against the workflow job
// names, but it is pure and offline: it cannot ask GitHub whether that file
// still describes reality. A UI edit to branch protection makes the committed
// contract stale silently, and every gate here stays green while it does. The
// reconciliation has to run somewhere with a network, so it runs on a cron —
// and this asserts that it still does.

export const checkRulesetDriftWatch = (snap: HarnessSnapshot): readonly Finding[] =>
  snap.workflows.some(
    (workflow) => CRON_TRIGGER.test(workflow.text) && RULESET_DRIFT_RUN.test(workflow.text),
  )
    ? []
    : [
        {
          check: "ruleset-drift-watch",
          detail:
            "no workflow runs the ruleset drift comparison on a cron — branch protection edited through the GitHub UI would leave .github/rulesets/main.json stale with nothing to notice, and this offline checker would keep validating a contract nobody enforces",
        },
      ]

export const auditHarness = (snap: HarnessSnapshot): readonly Finding[] => [
  ...checkGritPlugins(snap),
  ...checkCorePurity(snap),
  ...checkCastBan(snap),
  ...checkOneParam(snap),
  ...checkCoreDoorBan(snap),
  ...checkLefthook(snap),
  ...checkScripts(snap),
  ...checkCiContexts(snap),
  ...checkActionPinning(snap),
  ...checkCanonSync(snap),
  ...checkTypecheckCoverage(snap),
  ...checkGateScope(snap),
  ...checkRequiredFiles(snap),
  ...checkEvalTasks(snap),
  ...checkScheduledAudit(snap),
  ...checkRulesetDriftWatch(snap),
]
