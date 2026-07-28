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

export type HarnessSnapshot = {
  readonly biome: string
  readonly lefthook: string
  readonly packageJson: string
  readonly unitTestsWorkflow: string
  readonly claudeMd: string
  readonly agentsMd: string
  readonly gritPlugins: readonly string[]
  readonly appTsconfigs: readonly string[]
  readonly appDirs: readonly string[]
  readonly presentFiles: readonly string[]
}

// The literal status-check contexts the branch ruleset requires. A PR cannot
// merge unless a check with each of these names reports in, so renaming a job
// silently makes every PR unmergeable ("base branch policy prohibits the
// merge") even when all visible checks are green. Asserting the names here
// turns that trap into a failing gate at authoring time.
export const REQUIRED_CI_CONTEXTS: readonly string[] = [
  "biome ci (lint + format)",
  "bun test (daemon + web)",
]

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
  "audit",
  "doctor",
  "axiom-debt",
  "verify",
]

// Gates that must be *composed* into a command CI already runs, not merely
// present as a script somebody could forget to call.
const COMPOSED_GATES: readonly { readonly script: string; readonly needle: string }[] = [
  { script: "test", needle: "check-colocated-tests.ts" },
  { script: "test", needle: "check-harness.ts" },
  { script: "verify", needle: "lint:ci" },
  { script: "verify", needle: "typecheck" },
  { script: "verify", needle: "test" },
  { script: "verify", needle: "audit" },
  { script: "verify", needle: "axiom-debt" },
]

const REQUIRED_FILES: readonly string[] = [
  "scripts/axiom-debt.json",
  "scripts/check-axiom-debt.ts",
  "scripts/check-colocated-tests.ts",
  "scripts/check-commit-msg.ts",
  "scripts/check-feature-tests.sh",
  "scripts/check-tests-touched.sh",
  "scripts/typecheck.ts",
  "stryker.config.json",
]

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

  // --- CI: required contexts intact, actions pinned -----------------------
  for (const context of REQUIRED_CI_CONTEXTS) {
    if (!snap.unitTestsWorkflow.includes(context)) {
      miss({
        check: "ci-contexts",
        detail: `no CI job named "${context}" — the branch ruleset requires that exact context, so PRs would never become mergeable`,
      })
    }
  }
  for (const ref of unpinnedActions(snap.unitTestsWorkflow)) {
    miss({
      check: "action-pinning",
      detail: `unit-tests.yml uses ${ref} — pin actions to a full commit SHA`,
    })
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
  for (const dir of snap.appDirs) {
    if (!snap.appTsconfigs.includes(`${dir}/tsconfig.json`)) {
      miss({
        check: "typecheck",
        detail: `${dir} has no tsconfig.json, so it escapes the typecheck gate`,
      })
    }
  }

  // --- Gate scripts still on disk ----------------------------------------
  for (const file of REQUIRED_FILES) {
    if (!snap.presentFiles.includes(file)) miss({ check: "files", detail: `${file} is missing` })
  }

  return findings
}
