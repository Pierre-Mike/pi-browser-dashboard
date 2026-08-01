import { describe, expect, it } from "bun:test"
import {
  auditHarness,
  CANON_END,
  CANON_START,
  CORE_DENIED_GLOBALS,
  canonBlock,
  checkActionPinning,
  checkCanonSync,
  checkCastBan,
  checkCiContexts,
  checkCoreDoorBan,
  checkCorePurity,
  checkEvalTasks,
  checkGateScope,
  checkGritPlugins,
  checkLefthook,
  checkOneParam,
  checkRequiredFiles,
  checkRulesetDriftWatch,
  checkScheduledAudit,
  checkScripts,
  checkTypecheckCoverage,
  type HarnessSnapshot,
  REQUIRED_GRIT_PLUGINS,
  requiredContextsOf,
  tasksMissingAsserts,
  unpinnedActions,
} from "./harness-doctor.core"

const canon = (body: string): string => `# doc\n${CANON_START}${body}${CANON_END}\ntail\n`

const SHA = "a".repeat(40)

// The contexts the fixture's ruleset requires. Mirrors the real split: three are
// jobs in unit-tests.yml, `Playwright` is a job in pr-e2e.yml.
const CONTEXTS = [
  "biome ci (lint + format)",
  "bun test (daemon + web)",
  "fallow audit (dead code)",
  "Playwright",
]

const ruleset = (contexts: readonly string[]): string =>
  JSON.stringify({
    name: "main protection",
    rules: [
      { type: "deletion" },
      {
        type: "required_status_checks",
        parameters: { required_status_checks: contexts.map((context) => ({ context })) },
      },
    ],
  })

const TRACKED = [
  ".bun-version",
  ".github/dependabot.yml",
  ".github/rulesets/main.json",
  ".github/scripts/apply-ruleset.sh",
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
  "scripts/check-ruleset-drift.ts",
  "scripts/check-tests-touched.sh",
  "scripts/ruleset-drift.core.ts",
  "scripts/scaffold-slice.ts",
  "scripts/scaffold-theme.ts",
  "scripts/theme-solve.core.ts",
  "scripts/theme-emit.core.ts",
  "scripts/theme-check.ts",
  "scripts/typecheck.ts",
  "shared/src/index.ts",
  "stryker.config.json",
  "evals/run.ts",
  "evals/probe.ts",
  "evals/report.ts",
  "evals/score.core.ts",
]

// One well-formed eval task: a prompt plus at least one assert. The assert is
// what distinguishes a working agent from one that did nothing, since the gate
// jury is green on an untouched checkout.
const EVAL_TASKS = `${JSON.stringify({
  id: "backoff-pure-algorithm",
  archetype: "pure-algorithm",
  suites: ["smoke"],
  prompt: "…",
  asserts: [{ name: "responds 200", run: "bun evals/probe.ts --path /backoff/delay" }],
})}\n`

// A snapshot with every gate in place — each test then removes exactly one
// thing and asserts the doctor notices.
const healthy = (): HarnessSnapshot => ({
  biome: JSON.stringify({
    linter: { rules: { style: { noRestrictedImports: { options: { paths: { axios: {} } } } } } },
    overrides: [
      {
        includes: ["apps/**/*.ts", "scripts/**/*.ts", "shared/**/*.ts"],
        plugins: ["./biome-plugins/no-cast-json.grit"],
      },
      {
        includes: ["**/*.core.ts", "**/*.core.tsx"],
        plugins: [
          "./biome-plugins/no-throw-in-core.grit",
          "./biome-plugins/no-await-in-core.grit",
          "./biome-plugins/max-one-param-declarations.grit",
        ],
        deniedGlobals: Object.fromEntries(CORE_DENIED_GLOBALS.map((g) => [g, "no"])),
        importNames: ["Effect", "Layer", "Context"],
        // The door ban has to live in *this* override — the shape-scoped one —
        // and in a `group` array rather than only in the prose of a `message`.
        importPatterns: [
          { group: ["**/*.io"], message: "no io in a core" },
          { group: ["**/*.door"], message: "a *.door.ts re-exports a Tag" },
        ],
      },
    ],
  }),
  lefthook: [
    "name: biome",
    "name: tdd-gate",
    "name: conventional-commit",
    "name: feature-test-floor",
    "name: typecheck",
    "name: axiom-debt",
    "name: unit",
    "name: vocabulary",
  ].join("\n"),
  packageJson: JSON.stringify({
    scripts: {
      lint: "biome check --write .",
      "lint:ci": "biome ci .",
      typecheck: "bun run scripts/typecheck.ts",
      test: "bun run scripts/check-colocated-tests.ts && bun run scripts/check-harness.ts && bun run vocabulary && bun run test:shared && bun run test:evals",
      "test:web": "cd apps/web && bun test",
      "test:cli": "cd apps/cli && bun test",
      "test:shared": "cd shared && bun test",
      "test:mutation": "bunx stryker run",
      "build:cli": "bun run build:web:cli && cd apps/cli && bun run build",
      audit: "fallow audit",
      doctor: "bun run scripts/check-harness.ts",
      vocabulary: "bun run scripts/check-vocabulary.ts --all",
      "axiom-debt": "bun run scripts/check-axiom-debt.ts",
      "axiom-debt:update": "bun run scripts/check-axiom-debt.ts --update",
      "scaffold:slice": "bun run scripts/scaffold-slice.ts",
      "scaffold:theme": "bun run scripts/scaffold-theme.ts",
      "theme:check": "bun run scripts/theme-check.ts",
      evals: "./evals/run.sh",
      verify:
        "bun run lint:ci && bun run typecheck && bun run test && bun run test:web && bun run test:cli && bun run audit && bun run axiom-debt",
      "test:evals": "bun test ./evals",
      "evals:baseline": "bun run evals/run.ts --baseline --suite full",
      "evals:report": "bun run evals/report.ts",
    },
  }),
  claudeMd: canon("\nshared canon\n"),
  agentsMd: canon("\nshared canon\n"),
  ruleset: ruleset(CONTEXTS),
  gritPlugins: REQUIRED_GRIT_PLUGINS.map((p) => `biome-plugins/${p}`),
  workspaceDirs: ["apps/daemon", "apps/web", "shared"],
  workspaceTsconfigs: [
    "apps/daemon/tsconfig.json",
    "apps/web/tsconfig.json",
    "shared/tsconfig.json",
  ],
  presentFiles: [...TRACKED],
  workflows: [
    {
      name: "unit-tests.yml",
      text: [
        ...CONTEXTS.filter((c) => c !== "Playwright").map((c) => `    name: ${c}`),
        `      - uses: actions/checkout@${SHA}`,
      ].join("\n"),
    },
    {
      name: "pr-e2e.yml",
      text: ["    name: Playwright", "      - name: Install Playwright browsers"].join("\n"),
    },
    { name: "codeql.yml", text: `      - uses: github/codeql-action/init@${SHA}` },
    // The scheduled advisory scan, matched by shape — a cron trigger and a
    // `bun audit` run in the same workflow — never by filename.
    {
      name: "dependency-audit.yml",
      text: ['    - cron: "17 6 * * *"', "      - run: bun audit --json"].join("\n"),
    },
    // The ruleset-drift watch, matched the same way: a cron trigger and the
    // drift comparison in one file, never by filename.
    {
      name: "ruleset-drift.yml",
      text: [
        '    - cron: "41 7 * * *"',
        "      - run: bun scripts/check-ruleset-drift.ts .github/rulesets/main.json live.json",
      ].join("\n"),
    },
  ],
  gateSources: {
    "scripts/typecheck.ts": "const patterns = parseWorkspacePatterns({ pkg })",
    "scripts/check-axiom-debt.ts": "const patterns = parseWorkspacePatterns({ pkg })",
  },
  evalTasks: EVAL_TASKS,
})

const checksFor = (snap: HarnessSnapshot): readonly string[] =>
  auditHarness(snap).map((f) => f.check)

describe("auditHarness", () => {
  it("reports nothing when the whole stack is wired", () => {
    expect(auditHarness(healthy())).toEqual([])
  })

  it("catches a grit plugin dropped from biome.json", () => {
    const snap = { ...healthy(), biome: healthy().biome.replace("no-throw-in-core.grit", "gone") }
    expect(checksFor(snap)).toContain("biome-plugins")
  })

  it("catches a grit plugin deleted from disk", () => {
    const snap = { ...healthy(), gritPlugins: ["biome-plugins/no-cast-json.grit"] }
    expect(checksFor(snap)).toContain("biome-plugins")
  })

  // Asserted against `checkCorePurity` rather than the combined list: two checks
  // emit `core-purity` (this one and the door ban), so `toContain("core-purity")`
  // could pass on the wrong finding entirely.
  it("catches the *.core.ts override losing its shape scope", () => {
    const snap = {
      ...healthy(),
      biome: healthy().biome.replaceAll('"**/*.core.ts"', '"apps/daemon/src/**/*.core.ts"'),
    }
    expect(checkCorePurity(snap).map((f) => f.detail)).toContain(
      'biome.json has no override scoped to "**/*.core.ts"',
    )
  })

  it("catches a denied core global being un-denied", () => {
    const snap = { ...healthy(), biome: healthy().biome.replace('"setInterval":', '"x":') }
    expect(checkCorePurity(snap).map((f) => f.detail)).toContain(
      "the *.core.ts override does not deny the setInterval global",
    )
  })

  // The one-param plugin began life scoped to scripts/** only. Narrowing it back
  // to a directory would make it a rule about a folder, not about a file shape.
  it("catches the one-param plugin no longer covering the pure cores", () => {
    const narrowed = JSON.parse(healthy().biome) as {
      overrides: { includes: string[]; plugins?: string[] }[]
    }
    const coreOverride = narrowed.overrides[1]
    if (coreOverride?.plugins) {
      coreOverride.plugins = coreOverride.plugins.filter(
        (p) => !p.includes("max-one-param-declarations"),
      )
    }
    narrowed.overrides[0]?.plugins?.push("./biome-plugins/max-one-param-declarations.grit")
    expect(checksFor({ ...healthy(), biome: JSON.stringify(narrowed) })).toContain("one-param")
  })

  // The json-cast debt class was retired on the strength of this rule covering
  // every workspace; narrowing it back would re-open a class nothing watches.
  it("catches the cast ban being narrowed off apps/**", () => {
    const snap = {
      ...healthy(),
      biome: healthy().biome.replace(`"apps/**/*.ts",`, ""),
    }
    expect(checksFor(snap)).toContain("no-cast-json")
  })

  // A door re-exports a service Context.Tag, so a core importing one pulls the
  // Effect runtime in past the ban on `effect` itself. Note what survives this
  // edit: the rule's `message` still spells `*.door.ts`, and an earlier draft of
  // the check was satisfied by exactly that — prose about a rule that was gone.
  it("catches the door ban being dropped from the core override", () => {
    const snap = { ...healthy(), biome: healthy().biome.replace('"**/*.door"', '"**/*.nope"') }
    // The door check specifically, not any `core-purity` finding: the rest of the
    // core override is untouched here, so a combined filter would also pass if
    // this check had been deleted outright.
    expect(checkCoreDoorBan(snap)).toHaveLength(1)
    expect(checkCorePurity(snap)).toEqual([])
  })

  // Scoped by shape or not at all: a door ban sitting in a path-scoped override
  // evaporates the next time an app is renamed — the exact decay this checker
  // exists to catch — so finding the pattern *somewhere* in biome.json is not
  // enough.
  it("rejects a door ban parked outside the shape-scoped override", () => {
    type Pattern = { group: string[]; message?: string }
    const moved = JSON.parse(healthy().biome) as {
      overrides: { includes: string[]; importPatterns?: Pattern[] }[]
    }
    const coreOverride = moved.overrides[1]
    if (coreOverride) coreOverride.importPatterns = [{ group: ["**/*.io"] }]
    moved.overrides.unshift({
      includes: ["apps/daemon/src/**/*.ts"],
      importPatterns: [{ group: ["**/*.door"] }],
    })
    expect(checkCoreDoorBan({ ...healthy(), biome: JSON.stringify(moved) })).toHaveLength(1)
  })

  it("catches a deleted lefthook job", () => {
    const snap = { ...healthy(), lefthook: healthy().lefthook.replace("name: axiom-debt", "") }
    expect(checksFor(snap)).toContain("lefthook")
  })

  // A vocabulary decays quietly: nothing breaks when a retired word creeps
  // back, so nothing surfaces it either. Both halves are asserted — the
  // pre-commit job that catches a word as it is typed, and the full sweep in
  // `test` that catches one arriving past the hook (a rename, `--no-verify`).
  it("catches a deleted vocabulary hook", () => {
    const snap = { ...healthy(), lefthook: healthy().lefthook.replace("name: vocabulary", "") }
    expect(checksFor(snap)).toContain("lefthook")
  })

  it("catches the vocabulary sweep dropping out of the test script", () => {
    const pkg = JSON.parse(healthy().packageJson) as { scripts: Record<string, string> }
    pkg.scripts.test = pkg.scripts.test?.replace(" && bun run vocabulary", "") ?? ""
    expect(checksFor({ ...healthy(), packageJson: JSON.stringify(pkg) })).toContain("scripts")
  })

  it("catches a gate that is no longer composed into the test script", () => {
    const pkg = JSON.parse(healthy().packageJson) as { scripts: Record<string, string> }
    pkg.scripts.test = "bun test"
    expect(checksFor({ ...healthy(), packageJson: JSON.stringify(pkg) })).toContain("scripts")
  })

  it("catches the shared-contract suite dropping out of the test script", () => {
    const pkg = JSON.parse(healthy().packageJson) as { scripts: Record<string, string> }
    pkg.scripts.test =
      "bun run scripts/check-colocated-tests.ts && bun run scripts/check-harness.ts"
    expect(checksFor({ ...healthy(), packageJson: JSON.stringify(pkg) })).toContain("scripts")
  })

  // --- governance-as-code -------------------------------------------------
  // The contexts are read from the committed ruleset, so a check promoted in
  // the ruleset is guarded the moment the file records it — no second list to
  // forget. These cases cover the file itself going wrong.

  it("catches a missing ruleset file", () => {
    expect(checksFor({ ...healthy(), ruleset: "" })).toContain("governance")
  })

  it("catches a ruleset that is not valid JSON", () => {
    expect(checksFor({ ...healthy(), ruleset: "{ not json" })).toContain("governance")
  })

  // An empty required_status_checks list means any red PR can merge. It must not
  // be mistaken for "nothing to check", which is what an empty array would look
  // like to the loop below.
  it("catches a ruleset that requires no status checks", () => {
    expect(checksFor({ ...healthy(), ruleset: ruleset([]) })).toContain("governance")
  })

  // Promoting a check in the ruleset now guards it automatically — the whole
  // point. A context nothing declares is the trap, whichever direction it came
  // from.
  it("catches a newly required context that no workflow declares", () => {
    const snap = { ...healthy(), ruleset: ruleset([...CONTEXTS, "tsc --noEmit (all workspaces)"]) }
    expect(checksFor(snap)).toContain("ci-contexts")
  })

  it("reads the required contexts out of the ruleset", () => {
    expect(requiredContextsOf({ ruleset: ruleset(CONTEXTS) })).toEqual(CONTEXTS)
  })

  it("reports null, not an empty list, when the ruleset cannot be read", () => {
    expect(requiredContextsOf({ ruleset: "" })).toBeNull()
    expect(requiredContextsOf({ ruleset: "[]" })).toBeNull()
  })

  const withWorkflowText = (input: {
    readonly file: string
    readonly edit: (text: string) => string
  }): HarnessSnapshot => ({
    ...healthy(),
    workflows: healthy().workflows.map((w) =>
      w.name === input.file ? { ...w, text: input.edit(w.text) } : w,
    ),
  })

  it("catches a renamed CI job that the branch ruleset still requires", () => {
    const snap = withWorkflowText({
      file: "unit-tests.yml",
      edit: (t) => t.replace("bun test (daemon + web)", "bun test (all)"),
    })
    expect(checksFor(snap)).toContain("ci-contexts")
  })

  // The contexts are not all in one workflow. `Playwright` is required by the
  // ruleset and declared in pr-e2e.yml; a check that only read unit-tests.yml
  // reported green while renaming that job made every PR unmergeable.
  it("catches a renamed required job in a workflow other than unit-tests.yml", () => {
    const snap = withWorkflowText({
      file: "pr-e2e.yml",
      edit: (t) => t.replace("    name: Playwright", "    name: e2e"),
    })
    expect(checksFor(snap)).toContain("ci-contexts")
  })

  // "Playwright" survives that rename inside the step name "Install Playwright
  // browsers", so a substring search would still pass. Only a `name:` line that
  // declares the job itself counts.
  it("does not accept a required context that appears only in a step name", () => {
    const snap = withWorkflowText({
      file: "pr-e2e.yml",
      edit: (t) => t.replace("    name: Playwright\n", ""),
    })
    expect(checksFor(snap)).toContain("ci-contexts")
  })

  it("catches an unpinned action in unit-tests.yml", () => {
    const snap = {
      ...healthy(),
      workflows: [
        { name: "unit-tests.yml", text: "      - uses: oven-sh/setup-bun@v2" },
        ...healthy().workflows.slice(1),
      ],
    }
    expect(checksFor(snap)).toContain("action-pinning")
  })

  // Pinning is checked across every workflow on disk, not just the CI one — a
  // newly added workflow must not be able to skip the rule.
  it("catches an unpinned action in a workflow other than unit-tests.yml", () => {
    const snap = {
      ...healthy(),
      workflows: [
        ...healthy().workflows,
        { name: "release.yml", text: "      - uses: softprops/action-gh-release@v2" },
      ],
    }
    const findings = auditHarness(snap)
    expect(findings.map((f) => f.check)).toContain("action-pinning")
    expect(findings.some((f) => f.detail.includes("release.yml"))).toBe(true)
  })

  it("catches the workflows directory disappearing entirely", () => {
    expect(checksFor({ ...healthy(), workflows: [] })).toContain("action-pinning")
  })

  it("catches the canon block drifting between CLAUDE.md and AGENTS.md", () => {
    const snap = { ...healthy(), agentsMd: canon("\nsomething else\n") }
    expect(checksFor(snap)).toContain("canon")
  })

  it("catches a workspace with no tsconfig", () => {
    const snap = { ...healthy(), workspaceDirs: [...healthy().workspaceDirs, "packages/new"] }
    expect(checksFor(snap)).toContain("typecheck")
  })

  // shared/ is a workspace but not an app. An `apps/*` scan here would have
  // called the stack intact while shared/ escaped both gates.
  it("covers a non-app workspace in the typecheck check", () => {
    const snap = {
      ...healthy(),
      workspaceTsconfigs: healthy().workspaceTsconfigs.filter((p) => !p.startsWith("shared/")),
    }
    const findings = auditHarness(snap)
    expect(findings.some((f) => f.check === "typecheck" && f.detail.includes("shared"))).toBe(true)
  })

  it("catches a gate script that stops deriving its scope from `workspaces`", () => {
    const snap = {
      ...healthy(),
      gateSources: {
        ...healthy().gateSources,
        "scripts/typecheck.ts": 'new Glob("apps/*/tsconfig.json")',
      },
    }
    expect(checksFor(snap)).toContain("gate-scope")
  })

  // Merely mentioning `workspaces` is not enough: a type assertion reads the
  // field without validating it, so a shape change would make the gate scan
  // nothing while still matching a word-level check.
  it("rejects a gate that reads `workspaces` through an assertion instead of the parser", () => {
    const asserted = ["const pkg = (await f", "json())", "as { workspaces?: string[] }"].join(".")
    const snap = {
      ...healthy(),
      gateSources: { ...healthy().gateSources, "scripts/check-axiom-debt.ts": asserted },
    }
    expect(checksFor(snap)).toContain("gate-scope")
  })

  it("catches a gate script that cannot be read at all", () => {
    const snap = { ...healthy(), gateSources: {} }
    expect(checksFor(snap)).toContain("gate-scope")
  })

  it("catches a deleted gate script", () => {
    const snap = {
      ...healthy(),
      presentFiles: healthy().presentFiles.filter((f) => f !== "scripts/typecheck.ts"),
    }
    expect(checksFor(snap)).toContain("files")
  })

  it("catches the eval task set being deleted", () => {
    const snap = {
      ...healthy(),
      presentFiles: healthy().presentFiles.filter((f) => f !== "evals/tasks.jsonl"),
    }
    expect(checksFor(snap)).toContain("files")
  })

  // The advisory scan is the one gate whose trigger is the point: de-schedule it
  // and it still passes every other check while scanning nothing. These four
  // pin the shape — cron present, audit present, both in one file — and prove a
  // rename cannot fail the check open.
  it("catches the advisory scan losing its cron (the quiet-repo blind spot)", () => {
    const snap = withWorkflowText({
      file: "dependency-audit.yml",
      edit: (t) => t.replace(/^\s*-\s*cron:.*$/gm, ""),
    })
    expect(checksFor(snap)).toContain("scheduled-audit")
  })

  it("catches the advisory scan losing its `bun audit` step", () => {
    const snap = withWorkflowText({
      file: "dependency-audit.yml",
      edit: (t) => t.replace("bun audit --json", "bun outdated"),
    })
    expect(checksFor(snap)).toContain("scheduled-audit")
  })

  // A cron in one workflow and an audit in another is not a scheduled audit —
  // the repo already has two weekly crons that scan nothing of the sort.
  it("does not accept a cron and a `bun audit` in different workflows", () => {
    const snap = {
      ...healthy(),
      workflows: [
        ...healthy().workflows.filter((w) => w.name !== "dependency-audit.yml"),
        { name: "nightly.yml", text: '    - cron: "17 6 * * *"' },
        { name: "pr-audit.yml", text: "      - run: bun audit" },
      ],
    }
    expect(checksFor(snap)).toContain("scheduled-audit")
  })

  it("accepts a renamed advisory workflow that keeps the shape", () => {
    const snap = {
      ...healthy(),
      workflows: healthy().workflows.map((w) =>
        w.name === "dependency-audit.yml" ? { ...w, name: "supply-chain.yml" } : w,
      ),
    }
    expect(checksFor(snap)).not.toContain("scheduled-audit")
  })

  // The drift watch is the ONLY thing standing between a UI edit to branch
  // protection and a committed ruleset that silently stops describing reality —
  // this checker is offline, so it cannot notice on its own. Same four
  // red-team cases as the advisory scan, for the same reason.
  it("catches the drift watch losing its cron (the UI-edit blind spot)", () => {
    const snap = withWorkflowText({
      file: "ruleset-drift.yml",
      edit: (t) => t.replace(/^\s*-\s*cron:.*$/gm, ""),
    })
    expect(checksFor(snap)).toContain("ruleset-drift-watch")
  })

  it("catches the drift watch losing its comparison step", () => {
    const snap = withWorkflowText({
      file: "ruleset-drift.yml",
      edit: (t) => t.replace("check-ruleset-drift.ts", "echo skipped"),
    })
    expect(checksFor(snap)).toContain("ruleset-drift-watch")
  })

  it("does not accept a cron and a drift comparison in different workflows", () => {
    const snap = {
      ...healthy(),
      workflows: [
        ...healthy().workflows.filter((w) => w.name !== "ruleset-drift.yml"),
        { name: "nightly.yml", text: '    - cron: "41 7 * * *"' },
        { name: "pr-governance.yml", text: "      - run: bun scripts/check-ruleset-drift.ts" },
      ],
    }
    expect(checksFor(snap)).toContain("ruleset-drift-watch")
  })

  it("accepts a renamed drift workflow that keeps the shape", () => {
    const snap = {
      ...healthy(),
      workflows: healthy().workflows.map((w) =>
        w.name === "ruleset-drift.yml" ? { ...w, name: "governance-watch.yml" } : w,
      ),
    }
    expect(checksFor(snap)).not.toContain("ruleset-drift-watch")
  })

  it("catches the drift comparison script being deleted", () => {
    const snap = {
      ...healthy(),
      presentFiles: healthy().presentFiles.filter((f) => f !== "scripts/ruleset-drift.core.ts"),
    }
    expect(checksFor(snap)).toContain("files")
  })
})

// `auditHarness` is the spread of these, and each one is callable on its own so a
// red-team test can name the check it is about instead of filtering a combined
// findings list. Two of them (core purity and the door ban) emit the same `check`
// string, which is exactly the case a combined filter cannot distinguish.
const EVERY_CHECK = {
  checkGritPlugins,
  checkCorePurity,
  checkCastBan,
  checkOneParam,
  checkCoreDoorBan,
  checkLefthook,
  checkScripts,
  checkCiContexts,
  checkActionPinning,
  checkCanonSync,
  checkTypecheckCoverage,
  checkGateScope,
  checkRequiredFiles,
  checkEvalTasks,
  checkScheduledAudit,
  checkRulesetDriftWatch,
} as const

// Keeps the import list honest: `checkRulesetDriftWatch` must be in the spread
// too, which the "account for every finding" test below proves.

describe("per-check functions", () => {
  it("are all silent on a healthy snapshot", () => {
    const snap = healthy()
    const noisy = Object.entries(EVERY_CHECK)
      .filter(([, check]) => check(snap).length > 0)
      .map(([name]) => name)
    expect(noisy).toEqual([])
  })

  it("account for every finding auditHarness reports", () => {
    // A check left out of the spread would be dead weight: it would pass its own
    // test and never run in `bun run doctor`. Comparing counts on a broken
    // snapshot catches that, which asserting on `healthy()` alone cannot.
    const broken: HarnessSnapshot = {
      ...healthy(),
      lefthook: "",
      ruleset: "{",
      evalTasks: "",
      presentFiles: [],
    }
    const summed = Object.values(EVERY_CHECK).flatMap((check) => check(broken))
    expect(auditHarness(broken)).toEqual(summed)
    expect(summed.length).toBeGreaterThan(0)
  })
})

describe("canonBlock", () => {
  it("extracts the text between the markers", () => {
    expect(canonBlock(canon("body"))).toBe("body")
  })

  it("returns null when a marker is missing or inverted", () => {
    expect(canonBlock("no markers")).toBeNull()
    expect(canonBlock(`${CANON_END}x${CANON_START}`)).toBeNull()
  })
})

describe("unpinnedActions", () => {
  it("accepts a full 40-char SHA", () => {
    expect(unpinnedActions(`uses: actions/checkout@${"0".repeat(40)}`)).toEqual([])
  })

  it("flags tags, branches and short SHAs", () => {
    expect(unpinnedActions("uses: actions/checkout@v4")).toEqual(["actions/checkout@v4"])
    expect(unpinnedActions("uses: a/b@main")).toEqual(["a/b@main"])
    expect(unpinnedActions("uses: a/b@abc1234")).toEqual(["a/b@abc1234"])
  })

  it("ignores an expression-driven ref", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting GitHub's own expression syntax
    expect(unpinnedActions("uses: a/b@${{ env.REF }}")).toEqual([])
  })
})

describe("tasksMissingAsserts", () => {
  const withAsserts = JSON.stringify({
    id: "ok",
    asserts: [{ name: "a", run: "true" }],
  })

  it("passes a task set where every task carries an assert", () => {
    expect(tasksMissingAsserts({ jsonl: `${withAsserts}\n${withAsserts}\n` })).toEqual([])
  })

  it("names a task whose asserts are missing or empty", () => {
    const none = JSON.stringify({ id: "gates-only", prompt: "do a thing" })
    const empty = JSON.stringify({ id: "empty-asserts", asserts: [] })
    const problems = tasksMissingAsserts({ jsonl: `${withAsserts}\n${none}\n${empty}\n` })
    expect(problems.map((p) => p.label)).toEqual(["gates-only", "empty-asserts"])
    expect(problems.every((p) => p.reason.includes("no asserts"))).toBe(true)
  })

  it("reports a line that is not a JSON object rather than throwing at cell 1 of a paid grid", () => {
    const problems = tasksMissingAsserts({ jsonl: `${withAsserts}\nnot json\n[1,2]\n` })
    expect(problems.map((p) => p.label)).toEqual(["line 2", "line 3"])
  })

  it("rejects an empty task set — a grid with no tasks measures nothing", () => {
    expect(tasksMissingAsserts({ jsonl: "\n  \n" })).toHaveLength(1)
  })
})

describe("auditHarness (eval tasks)", () => {
  it("catches an eval task with no asserts, which the gates alone would score green", () => {
    const snap = {
      ...healthy(),
      evalTasks: `${JSON.stringify({ id: "free-points", prompt: "…" })}\n`,
    }
    expect(checksFor(snap)).toContain("eval-tasks")
  })

  it("catches the task list being emptied", () => {
    expect(checksFor({ ...healthy(), evalTasks: "" })).toContain("eval-tasks")
  })
})
