import { describe, expect, it } from "bun:test"
import {
  auditHarness,
  CANON_END,
  CANON_START,
  CORE_DENIED_GLOBALS,
  canonBlock,
  type HarnessSnapshot,
  REQUIRED_CI_CONTEXTS,
  REQUIRED_GRIT_PLUGINS,
  unpinnedActions,
} from "./harness-doctor.core"

const canon = (body: string): string => `# doc\n${CANON_START}${body}${CANON_END}\ntail\n`

const SHA = "a".repeat(40)

const TRACKED = [
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
  ].join("\n"),
  packageJson: JSON.stringify({
    scripts: {
      lint: "biome check --write .",
      "lint:ci": "biome ci .",
      typecheck: "bun run scripts/typecheck.ts",
      test: "bun run scripts/check-colocated-tests.ts && bun run scripts/check-harness.ts && bun run test:shared",
      "test:web": "cd apps/web && bun test",
      "test:cli": "cd apps/cli && bun test",
      "test:shared": "cd shared && bun test",
      "test:mutation": "bunx stryker run",
      "build:cli": "bun run build:web:cli && cd apps/cli && bun run build",
      audit: "fallow audit",
      doctor: "bun run scripts/check-harness.ts",
      "axiom-debt": "bun run scripts/check-axiom-debt.ts",
      "axiom-debt:update": "bun run scripts/check-axiom-debt.ts --update",
      "scaffold:slice": "bun run scripts/scaffold-slice.ts",
      evals: "./evals/run.sh",
      verify:
        "bun run lint:ci && bun run typecheck && bun run test && bun run test:web && bun run test:cli && bun run audit && bun run axiom-debt",
    },
  }),
  claudeMd: canon("\nshared canon\n"),
  agentsMd: canon("\nshared canon\n"),
  gritPlugins: REQUIRED_GRIT_PLUGINS.map((p) => `biome-plugins/${p}`),
  workspaceDirs: ["apps/daemon", "apps/web", "shared"],
  workspaceTsconfigs: [
    "apps/daemon/tsconfig.json",
    "apps/web/tsconfig.json",
    "shared/tsconfig.json",
  ],
  presentFiles: [...TRACKED],
  // Mirrors the real split: most required contexts are jobs in unit-tests.yml,
  // but `Playwright` is declared in pr-e2e.yml. The fixture keeps them apart so
  // the cross-workflow search is exercised rather than assumed.
  workflows: [
    {
      name: "unit-tests.yml",
      text: [
        ...REQUIRED_CI_CONTEXTS.filter((c) => c !== "Playwright").map((c) => `    name: ${c}`),
        `      - uses: actions/checkout@${SHA}`,
      ].join("\n"),
    },
    {
      name: "pr-e2e.yml",
      text: ["    name: Playwright", "      - name: Install Playwright browsers"].join("\n"),
    },
    { name: "codeql.yml", text: `      - uses: github/codeql-action/init@${SHA}` },
  ],
  gateSources: {
    "scripts/typecheck.ts": "const patterns = parseWorkspacePatterns({ pkg })",
    "scripts/check-axiom-debt.ts": "const patterns = parseWorkspacePatterns({ pkg })",
  },
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

  it("catches the *.core.ts override losing its shape scope", () => {
    const snap = {
      ...healthy(),
      biome: healthy().biome.replaceAll('"**/*.core.ts"', '"apps/daemon/src/**/*.core.ts"'),
    }
    expect(checksFor(snap)).toContain("core-purity")
  })

  it("catches a denied core global being un-denied", () => {
    const snap = { ...healthy(), biome: healthy().biome.replace('"setInterval":', '"x":') }
    expect(checksFor(snap)).toContain("core-purity")
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
    expect(checksFor(snap)).toContain("core-purity")
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
    expect(checksFor({ ...healthy(), biome: JSON.stringify(moved) })).toContain("core-purity")
  })

  it("catches a deleted lefthook job", () => {
    const snap = { ...healthy(), lefthook: healthy().lefthook.replace("name: axiom-debt", "") }
    expect(checksFor(snap)).toContain("lefthook")
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
