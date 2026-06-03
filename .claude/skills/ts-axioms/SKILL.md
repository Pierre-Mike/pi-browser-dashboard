---
name: ts-axioms
description: >
  Engineering axioms and canonical tooling choices for TypeScript/JavaScript projects.
  Use when: (1) setting up a new TypeScript project or repo, (2) choosing between
  linters, formatters, hook runners, or test runners — Biome replaces ESLint and
  Prettier, Lefthook replaces husky and lint-staged, bun replaces npm and yarn,
  (3) designing module architecture or deciding where to put business logic —
  use Functional Core / Imperative Shell, (4) handling errors or choosing between
  try/catch and a typed error library — Effect-TS is the default, (5) setting up
  pre-commit hooks or CI pipelines, (6) writing tests — co-located, never
  centralised, (7) finding dead code, unused exports, circular deps, duplication,
  or complexity hotspots — use Fallow. Activate whenever the user mentions ESLint,
  Prettier, husky, lint-staged, npm, yarn, jest, Zod, try/catch, tsyringe,
  InversifyJS, a DI framework, or dep-graph analysis — each signals the canonical
  alternative. Every principle is enforced by a tool; no enforcement, no rule.
---

# Basic Knowledge

> Engineering axioms for humans and AI agents. Every principle must be enforced by a tool — Biome, compiler, CI check, pre-commit hook, or policy gate.

## Canonical Tooling Stack

Replace these automatically — do not ask:

| Instead of | Use |
|---|---|
| ESLint + Prettier | **Biome** (`biome check --write` on save; `biome ci` in CI) |
| husky + lint-staged | **Lefthook** (`stage_fixed: true` for auto-fix + re-stage) |
| npm / yarn | **bun** |
| Zod | **@effect/Schema** (`bun add @effect/schema` — bidirectional encode/decode, branded types) |
| try/catch | **Effect-TS** `Effect<A, E, R>` |
| tsyringe / InversifyJS | **Effect Layers** (`Context.Tag` + `Layer`) |
| Jest / Vitest mocks | **Effect test Layers** (no mock frameworks needed) |
| manual dead-code / dep-graph review | **Fallow** (`bunx fallow audit` in CI; Lefthook pre-push) |

### Lefthook — `stage_fixed: true`

Configure Biome with `--write` and `stage_fixed: true` so fixes are applied and re-staged in one commit:

```yaml
# lefthook.yml
pre-commit:
  commands:
    biome:
      glob: "*.{ts,js,json}"
      run: bunx biome check --write --no-errors-on-unmatched {staged_files}
      stage_fixed: true   # re-stages fixed files — no second commit needed
```

Wire `lefthook install` to the `prepare` script in `package.json` so hooks activate after `bun install`.

## Architecture: Functional Core / Imperative Shell

All business logic in pure functions; all I/O in a thin coordinating shell.

```
src/
├── core/     # PURE — no I/O, no side effects, no imports from infra/ or shell/
├── infra/    # Effect services (one per external system) with Context.Tag
├── shell/    # Effect.gen sandwich coordinators — orchestrate core + infra
└── main.ts   # Composition root — provides live Layers, runs effects
```

Every shell function follows **impure(read) → pure(compute) → impure(write)**:

```ts
const processOrder = Effect.gen(function* () {
  const db = yield* Database;                     // impure read
  const order = yield* db.getOrder("123");
  const validated = yield* validateOrder(order);  // pure compute (core/)
  yield* db.saveOrder(validated);                 // impure write
});
```

Pure `core/` functions are unit-tested with data in / data out — no mocks. Infra is tested with test `Layer`s. No mock frameworks needed.

## Named Parameters

Use destructured object arguments for functions with 3+ parameters:

```ts
// Avoid
function createUser(name: string, role: string, active: boolean) {}

// Prefer
function createUser({ name, role, active }: { name: string; role: string; active: boolean }) {}
```

Enforce via Biome `complexity/useMaxParams` with `max: 2`.

## Co-located Tests

`foo.ts` → `foo.test.ts` in the same directory. Never mirror the source tree under `__tests__/` or `tests/`.

## Codebase Intelligence: Fallow

[Fallow](https://fallow.tools/) is Rust-native static analysis for TS/JS: unused code, duplication, circular deps, complexity hotspots, architecture boundaries. Deterministic, sub-second, zero-AI inside the analyzer.

Install: `bun add -d fallow` — config in `.fallowrc.json`.

- **CI:** `bunx fallow audit` — exits `1` on findings the changeset introduced (`--gate all` to gate every finding in changed files). Default is changeset-only, so legacy debt lands incrementally.
- **Pre-push (Lefthook), not pre-commit:** dep-graph/duplication analysis is repo-wide and push-scoped; keep per-commit fast (Biome only).
- **Agents:** the npm package ships an MCP server — Claude Code queries reachability/duplication before editing.

```yaml
# lefthook.yml — add alongside the pre-commit biome block
pre-push:
  commands:
    fallow:
      run: bunx fallow audit
```

## Full Reference

For enforcement commands, CI configs, branching strategy, error handling, security, monitoring, and docs principles — see [`references/principles.md`](references/principles.md).
