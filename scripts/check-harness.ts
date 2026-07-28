#!/usr/bin/env bun
/**
 * `bun run doctor` — the harness self-check.
 *
 * Reads the enforcement stack off disk and hands it to the pure auditor in
 * scripts/harness-doctor.core.ts. Runs inside `bun run test`, so deleting a
 * gate fails CI instead of silently disarming a rule.
 */
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { Glob } from "bun"
import { auditHarness, type HarnessSnapshot } from "./harness-doctor.core"

const root = join(import.meta.dir, "..")
const read = async (rel: string): Promise<string> =>
  Bun.file(join(root, rel))
    .text()
    .catch(() => "")

const gritPlugins: string[] = []
for await (const file of new Glob("biome-plugins/*.grit").scan({ cwd: root })) {
  gritPlugins.push(file)
}

const appDirs = readdirSync(join(root, "apps"), { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(join(root, "apps", e.name, "package.json")))
  .map((e) => `apps/${e.name}`)
  .sort()

const TRACKED_FILES = [
  "scripts/axiom-debt.json",
  "scripts/check-axiom-debt.ts",
  "scripts/check-colocated-tests.ts",
  "scripts/check-commit-msg.ts",
  "scripts/check-feature-tests.sh",
  "scripts/check-tests-touched.sh",
  "scripts/typecheck.ts",
  "stryker.config.json",
]

const snapshot: HarnessSnapshot = {
  biome: await read("biome.json"),
  lefthook: await read("lefthook.yml"),
  packageJson: await read("package.json"),
  unitTestsWorkflow: await read(".github/workflows/unit-tests.yml"),
  claudeMd: await read("CLAUDE.md"),
  agentsMd: await read("AGENTS.md"),
  gritPlugins,
  appTsconfigs: appDirs.map((d) => `${d}/tsconfig.json`).filter((p) => existsSync(join(root, p))),
  appDirs,
  presentFiles: TRACKED_FILES.filter((f) => existsSync(join(root, f))),
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
console.error("✓ harness self-check: enforcement stack intact")
