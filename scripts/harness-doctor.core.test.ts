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

// A snapshot with every gate in place — each test then removes exactly one
// thing and asserts the doctor notices.
const healthy = (): HarnessSnapshot => ({
  biome: JSON.stringify({
    plugins: REQUIRED_GRIT_PLUGINS.map((p) => `./biome-plugins/${p}`),
    linter: { rules: { style: { noRestrictedImports: { options: { paths: { axios: {} } } } } } },
    overrides: [
      {
        includes: ["**/*.core.ts"],
        deniedGlobals: Object.fromEntries(CORE_DENIED_GLOBALS.map((g) => [g, "no"])),
        importNames: ["Effect", "Layer", "Context"],
      },
      { includes: ["**/*.io.ts"], deniedGlobals: { fetch: "no" } },
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
      test: "bun run scripts/check-colocated-tests.ts && bun run scripts/check-harness.ts && bun test",
      "test:web": "cd apps/web && bun test",
      "test:cli": "cd apps/cli && bun test",
      audit: "fallow audit",
      doctor: "bun run scripts/check-harness.ts",
      "axiom-debt": "bun run scripts/check-axiom-debt.ts",
      verify:
        "bun run lint:ci && bun run typecheck && bun run test && bun run audit && bun run axiom-debt",
    },
  }),
  unitTestsWorkflow: [
    ...REQUIRED_CI_CONTEXTS.map((c) => `    name: ${c}`),
    `      - uses: actions/checkout@${"a".repeat(40)}`,
  ].join("\n"),
  claudeMd: canon("\nshared canon\n"),
  agentsMd: canon("\nshared canon\n"),
  gritPlugins: REQUIRED_GRIT_PLUGINS.map((p) => `biome-plugins/${p}`),
  appTsconfigs: ["apps/daemon/tsconfig.json", "apps/web/tsconfig.json"],
  appDirs: ["apps/daemon", "apps/web"],
  presentFiles: [
    "scripts/axiom-debt.json",
    "scripts/check-axiom-debt.ts",
    "scripts/check-colocated-tests.ts",
    "scripts/check-commit-msg.ts",
    "scripts/check-feature-tests.sh",
    "scripts/check-tests-touched.sh",
    "scripts/typecheck.ts",
    "stryker.config.json",
  ],
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
      biome: healthy().biome.replace('"**/*.core.ts"', '"apps/daemon/src/**/*.core.ts"'),
    }
    expect(checksFor(snap)).toContain("core-purity")
  })

  it("catches a denied core global being un-denied", () => {
    const snap = { ...healthy(), biome: healthy().biome.replace('"setInterval":', '"x":') }
    expect(checksFor(snap)).toContain("core-purity")
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

  it("catches a renamed CI job that the branch ruleset still requires", () => {
    const snap = {
      ...healthy(),
      unitTestsWorkflow: healthy().unitTestsWorkflow.replace(
        "bun test (daemon + web)",
        "bun test (all)",
      ),
    }
    expect(checksFor(snap)).toContain("ci-contexts")
  })

  it("catches an unpinned action", () => {
    const snap = {
      ...healthy(),
      unitTestsWorkflow: `${healthy().unitTestsWorkflow}\n      - uses: oven-sh/setup-bun@v2`,
    }
    expect(checksFor(snap)).toContain("action-pinning")
  })

  it("catches the canon block drifting between CLAUDE.md and AGENTS.md", () => {
    const snap = { ...healthy(), agentsMd: canon("\nsomething else\n") }
    expect(checksFor(snap)).toContain("canon")
  })

  it("catches a workspace with no tsconfig", () => {
    const snap = { ...healthy(), appDirs: ["apps/daemon", "apps/web", "apps/newapp"] }
    expect(checksFor(snap)).toContain("typecheck")
  })

  it("catches a deleted gate script", () => {
    const snap = {
      ...healthy(),
      presentFiles: healthy().presentFiles.filter((f) => f !== "scripts/typecheck.ts"),
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
