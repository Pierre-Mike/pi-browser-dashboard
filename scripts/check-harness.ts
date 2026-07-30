#!/usr/bin/env bun
/**
 * `bun run doctor` — the harness self-check.
 *
 * Reads the enforcement stack off disk and hands it to the pure auditor in
 * scripts/harness-doctor.core.ts. Runs inside `bun run test`, so deleting a
 * gate fails CI instead of silently disarming a rule.
 *
 * Everything here is *discovered*, never listed: workspaces come from root
 * package.json, workflows from the directory, grit plugins from a glob. A
 * hand-maintained list in the checker would fail open in exactly the way the
 * checker exists to prevent.
 */
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { Glob } from "bun"
import { auditHarness, type HarnessSnapshot, type Workflow } from "./harness-doctor.core"
import { expandWorkspacePattern, parseWorkspacePatterns } from "./workspaces.core"

const root = join(import.meta.dir, "..")
const read = async (rel: string): Promise<string> =>
  Bun.file(join(root, rel))
    .text()
    .catch(() => "")

const gritPlugins: string[] = []
for await (const file of new Glob("biome-plugins/*.grit").scan({ cwd: root })) {
  gritPlugins.push(file)
}

// --- workspaces, from the one list that must already be correct -------------

const entriesUnder = (pattern: string): readonly string[] => {
  if (!pattern.endsWith("/*")) return []
  const parent = join(root, pattern.slice(0, -2))
  if (!existsSync(parent)) return []
  return readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
}

const workspaceDirs = parseWorkspacePatterns({
  pkg: await Bun.file(join(root, "package.json")).json(),
})
  .flatMap((pattern) => expandWorkspacePattern({ pattern, entries: entriesUnder(pattern) }))
  .filter((label) => existsSync(join(root, label, "package.json")))
  .sort()

// --- workflows, from the directory ------------------------------------------

const workflows: Workflow[] = []
const workflowDir = join(root, ".github/workflows")
if (existsSync(workflowDir)) {
  for (const entry of readdirSync(workflowDir).sort()) {
    if (!entry.endsWith(".yml") && !entry.endsWith(".yaml")) continue
    workflows.push({ name: entry, text: await read(`.github/workflows/${entry}`) })
  }
}

// --- files whose presence, or whose shape, is part of the contract ----------

const TRACKED_FILES = [
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

const GATE_SOURCES = ["scripts/typecheck.ts", "scripts/check-axiom-debt.ts"]

const gateSources: Record<string, string> = {}
for (const rel of GATE_SOURCES) {
  if (existsSync(join(root, rel))) gateSources[rel] = await read(rel)
}

const snapshot: HarnessSnapshot = {
  biome: await read("biome.json"),
  lefthook: await read("lefthook.yml"),
  packageJson: await read("package.json"),
  claudeMd: await read("CLAUDE.md"),
  agentsMd: await read("AGENTS.md"),
  ruleset: await read(".github/rulesets/main.json"),
  gritPlugins,
  workspaceDirs,
  workspaceTsconfigs: workspaceDirs
    .map((d) => `${d}/tsconfig.json`)
    .filter((p) => existsSync(join(root, p))),
  presentFiles: TRACKED_FILES.filter((f) => existsSync(join(root, f))),
  workflows,
  gateSources,
  evalTasks: await read("evals/tasks.jsonl"),
}

const findings = auditHarness(snapshot)
if (findings.length > 0) {
  console.error("✖ harness self-check failed — the enforcement stack has holes:")
  for (const f of findings) console.error(`  [${f.check}] ${f.detail}`)
  console.error("")
  console.error("  Each finding is a rule that no longer applies. Re-wire it, or if the removal")
  console.error("  is deliberate, update scripts/harness-doctor.core.ts in the same commit.")
  process.exit(1)
}
console.error(
  `✓ harness self-check: enforcement stack intact (${workspaceDirs.length} workspaces, ${workflows.length} workflows)`,
)
