# Basic Knowledge

> Engineering axioms for humans and AI agents. Every principle here must be enforced by a tool — Biome, compiler, CI check, pre-commit hook, or policy gate. If a rule has no enforcement, it doesn't exist.

***

## Meta-Rule: Tooling Enforces, Humans Review

**Never rely on discipline or convention to uphold a rule.** If a principle matters, wire it into the pipeline so violations fail the build automatically. Humans and AI agents review intent; machines enforce constraints.

| Layer                   | Tool                                                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Compiler / type-checker | TypeScript strict mode, `tsc --noEmit`, `@effect/Schema`                                                          |
| Linter + Formatter      | **Biome** (`biome check --write` on save; `biome ci` in CI)                                                       |
| Pre-commit hooks        | Lefthook running `biome check --write` (auto-fix + re-stage via `stage_fixed: true`), `tsc --noEmit`, secret scan |
| CI gates                | GitHub Actions — `type-check → biome ci → test → mutation → SAST → build`                                         |
| Branch protection       | Require passing CI + review before merge; no direct push to main                                                  |
| Secret scanning         | Gitleaks + GitHub secret scanning on every push                                                                   |
| Dependency policy       | Renovate + `bun audit` in CI                                                                                      |
| Codebase intelligence   | **Fallow** — `bunx fallow audit` in CI + Lefthook pre-push (dead code, dup, circular deps, complexity, arch)      |

***

## Git Hooks: Lefthook

**Lefthook** is the standard hook runner (replaces lint-staged + husky).

### Auto-fix on commit — no extra commit needed

Configure Biome with `--write` and `stage_fixed: true` so fixes are applied **and re-staged** automatically:

```yaml
# lefthook.yml
pre-commit:
  commands:
    biome:
      glob: "*.{ts,js,json}"
      run: bunx biome check --write --no-errors-on-unmatched {staged_files}
      stage_fixed: true   # re-stages fixed files — no second commit needed
```

Flow on `git commit`:

1. Biome **auto-fixes** all staged files in place (`--write`)
2. Fixed files are **re-staged** automatically (`stage_fixed: true`)
3. Further checks (typecheck, tests…) run on already-clean code
4. Commit includes the fixes — zero extra commits

> This is functionally identical to what lint-staged provided with auto-fix.

*Enforce:* `lefthook install` wired to `prepare` script in `package.json` so hooks are always active after `bun install`.

***

## Codebase Intelligence: Fallow

[Fallow](https://fallow.tools/) is the standard codebase-intelligence engine for every TS/JS project (replaces manual dead-code hunts, ad-hoc `madge`/`dependency-cruiser` runs, and eyeballing complexity). Rust-native, sub-second, zero config, **no AI inside the analyzer** — deterministic findings with typed output contracts, so downstream tools and agents can trust them.

**Static layer (free):** unused code, duplication, circular deps, complexity hotspots, architecture boundaries, package hygiene.

Install: `bun add -d fallow` (ships CLI, LSP server, MCP server, and version-matched Agent Skill). Config: `.fallowrc.json` (JSONC accepted).

### CLI surface

| Command | Use |
| --- | --- |
| `bunx fallow` | Full codebase analysis |
| `bunx fallow audit` | PR/changeset gate — exit `1` on findings the changeset introduced; `--gate all` to fail on every finding in changed files |
| `bunx fallow health --score` | Health score for dashboards/trend tracking |

### Pre-push (Lefthook) — not pre-commit

Repo-wide dep-graph and duplication analysis is push-scoped; running it per-commit slows the inner loop. Biome stays the only pre-commit gate; Fallow runs at push against the upstream base.

```yaml
# lefthook.yml
pre-push:
  commands:
    fallow:
      run: bunx fallow audit
```

> Do **not** use `fallow hooks install --target git` — it writes a standalone git hook that bypasses Lefthook. Lefthook is the single hook runner (see above); wire Fallow as a Lefthook command instead.

### CI gate

```yaml
# .github/workflows/ci.yml — runs after biome ci, before build
- name: Fallow audit
  run: bunx fallow audit   # exit 1 fails the build on changeset findings
```

*Enforce:* changeset-only gating by default (legacy debt lands incrementally); escalate to `--gate all` per-repo once the baseline is clean. Agents query the bundled Fallow MCP server for reachability/duplication before editing — grounding suggestions in repo-wide truth.

***

## Design Philosophy

- **Deterministic > Non-deterministic**
  - *Enforce:* property-based tests (fast-check) in CI to prove same-input → same-output
- **Functional Programming > OOP**
  - *Enforce:* Biome `noParameterAssign`, `useConst`; ban `class` outside framework code via Biome `noRestrictedSyntax`
- **Named parameters (destructured object) > Positional parameters**
  - Prefer `function({ parameter, otherParam, anotherParam })` over `function(p, p2, p3)`. Named parameters are self-documenting at the call site, order-independent, and easier to extend without breaking callers.
  - *Enforce:* Biome `complexity/useMaxParams` with `maxParameters: 2` — any function with 3+ plain positional parameters is an error, pressuring towards a single destructured object argument.
    ```json
    {
      "linter": {
        "enabled": true,
        "rules": {
          "recommended": true,
          "complexity": {
            "useMaxParams": {
              "level": "error",
              "options": { "max": 2 }
            }
          }
        }
      }
    }
    ```
- **Immutability by default**
  - *Enforce:* TypeScript `readonly` on all types; `as const` assertions; Biome `useConst` bans `let` where `const` suffices
- **Atomic Design > Monolithic Components**
  - *Enforce:* Biome `complexity/noExcessiveCognitiveComplexity`; max file size enforced via custom Biome plugin or CI script (`find src -name "*.ts" | xargs wc -l | awk '$1>200'`)
- **Composition > Inheritance**
  - *Enforce:* TypeScript interfaces over abstract classes; Biome `noRestrictedSyntax` to ban `extends` on concrete classes
- **Single Responsibility**
  - *Enforce:* Biome `complexity/noExcessiveCognitiveComplexity` + `complexity/noExcessiveNestedTestSuites`; CI script fails if any file exceeds 200 lines
- **Code > Skill > Agent > Prompt**
  - *Enforce:* CI check rejects inline prompt strings in source; prompts must live in versioned `.md` files under `/prompts`

***

## Architecture: Functional Core / Imperative Shell

The concrete application of "Functional Programming > OOP". All business logic lives in pure functions; all I/O is pushed to a thin coordinating shell. Endorsed by Google Testing Blog (2025) and used in production at scale.

### The Impureim Sandwich

Every shell function follows: **impure(read) → pure(compute) → impure(write)**

```
src/
├── core/     # PURE — no I/O, no side effects, no imports from infra/ or shell/
├── infra/    # Effect services (one per external system) with Context.Tag
├── shell/    # Effect.gen sandwich coordinators — orchestrate core + infra
└── main.ts   # Composition root — provides live Layers, runs effects
```

- **Core:** pure functions, `Effect<A, E, never>` returns (no dependencies), zero I/O — unit-tested with no mocks, just data in / data out
- **Infra:** Effect services behind `Context.Tag` — tested by providing test `Layer`s (no `createNull()`, no fake `Deps` objects)
- **Shell:** `Effect.gen` coordinators following impure(read) → pure(compute) → impure(write) — tested by providing test Layers for infra + real core
- **No mock frameworks** — pure core + Effect Layers eliminate the need for Sinon/Jest mocks entirely

### Error Handling: Effect-TS

Use `Effect<A, E, R>` from [Effect-TS](https://effect.website/) instead of try/catch. Three typed channels: success value, typed error, and compile-time dependency requirements.

```ts
// Core — pure function, typed errors, no dependencies (R = never)
const validateOrder = (order: Order): Effect<ValidOrder, OrderError> =>
  // pure validation logic — no I/O

// Shell — Effect.gen (generators as async/await)
const processOrder = Effect.gen(function* () {
  const db = yield* Database;                     // declares dependency in the type
  const order = yield* db.getOrder("123");        // impure read
  const validated = yield* validateOrder(order);  // pure compute
  yield* db.saveOrder(validated);                 // impure write
});
// processOrder: Effect<void, OrderError | DbError, Database>
//               ↑ errors and deps accumulated automatically
```

For trivial scripts a hand-rolled discriminated union suffices: `{ ok: true; value: T } | { ok: false; error: E }`.

### Dependency Injection: Effect Layers

The core needs zero DI — it takes data, returns data. Infra uses `Context.Tag` + `Layer` for compile-time checked DI:

```ts
// 1. Define service interface
class Database extends Context.Tag("Database")<Database, {
  getOrder: (id: string) => Effect<Order, DbError>;
  saveOrder: (order: Order) => Effect<void, DbError>;
}>() {}

// 2. Production layer (main.ts)
const DatabaseLive = Layer.succeed(Database, {
  getOrder: (id) => Effect.tryPromise(() => pool.query(...)),
  saveOrder: (order) => Effect.tryPromise(() => pool.query(...)),
});

// 3. Test layer (tests) — replaces Nullables createNull() and fake Deps
const DatabaseTest = Layer.succeed(Database, {
  getOrder: (id) => Effect.succeed({ id, name: "Test User" }),
  saveOrder: (order) => Effect.void,
});

// 4. Run with different layers
Effect.runPromise(processOrder.pipe(Effect.provide(DatabaseLive)));   // production
Effect.runPromise(processOrder.pipe(Effect.provide(DatabaseTest)));   // test
```

No tsyringe, no InversifyJS, no decorators, no reflection. Missing Layer = **compile error**.

### Enforcement: 3-Layer Boundary Defense

- **Compiler** — TypeScript project references: `core/tsconfig.json` has zero `references`; `shell/tsconfig.json` references only `core`. Violations are compile errors.
- **Architecture tests** — `ts-arch` or `ArchUnitTS` in CI: `filesOfProject().inFolder("core").shouldNot().dependOnFiles().inFolder("infra")`
- **CI graph** — `dependency-cruiser` validates the full dependency graph and generates visual diagrams on every PR

*(Note: `eslint-plugin-boundaries` also works but since we use Biome, prefer the compiler + test layers above)*

### Effect-TS Is the Default

[Effect-TS](https://effect.website/) is the default for all new projects. The historic argument against it — steep learning curve, narrow hiring pool — does not apply when AI agents write and maintain the code. The complexity is managed through skills and rules, not human memorization.

Effect replaces the entire utility belt in one package:

| Replaced                  | Effect equivalent                                                 |
| ------------------------- | ----------------------------------------------------------------- |
| neverthrow `Result`       | `Effect<A, E, R>` (adds compile-time dep tracking)                |
| Zod                       | `@effect/Schema` (bidirectional encode/decode, branded types)     |
| Manual `Deps` objects     | `Layer` + `Context.Tag` (compile-time checked, lifecycle managed) |
| Nullables `createNull()`  | `Layer.succeed(TestImpl)` (no test code in production)            |
| p-retry, p-queue          | `Schedule` + `Effect.timeout` (composable, type-safe)             |
| Manual OpenTelemetry      | `Effect.withSpan` (one-liner, automatic context propagation)      |
| `Promise.all` (no cancel) | `Effect.all` + fiber supervision (automatic cancellation)         |

**When to stay simple (neverthrow or plain discriminated unions):**

Use neverthrow or hand-rolled `Result` only when **ALL** of these are true:

1. Zero retry, resource management, or concurrency needs
2. ≤3 chained Result operations
3. ≤5 dependencies total
4. No observability requirements
5. No structured concurrency

Otherwise → Effect-TS.

*Enforce:* AI agents use the `effect-ts` skill for correct idioms; `Effect.runPromise` calls restricted to `shell/` and `main.ts` via architecture tests in CI.

***

## Branching & Isolation

- **GitHub Flow + Trunk-Based Development**
  - One permanent branch: `main`. All work happens on short-lived feature branches cut directly from `main` and merged back via PR — no `develop`, `release/*`, or `hotfix/*` long-lived branches.
  - Branches must be small and short-lived (ideally merged within a day). If a branch lives longer than 2 days, it's a signal the scope is too large — break it into smaller PRs.
  - *Enforce:*
    - GitHub branch protection: `main` requires passing CI + at least 1 review before merge
    - Stale-branch bot (e.g. `github-actions/stale` or Mergify) closes branches idle for 2+ days with a warning
    - CI rejects PRs that target any branch other than `main`
    - Auto-delete branch after merge (GitHub repo setting)
- **No direct push to main**
  - *Enforce:* GitHub branch protection — require PR + passing CI; `CODEOWNERS` for critical paths
- **One branch per worktree**
  - *Enforce:* Git itself; pre-push Lefthook hook validates `git worktree list` has no duplicate branches
- **PR back to main only**
  - *Enforce:* Auto-delete branch after merge (repo setting); stale-branch bot closes branches idle for 2 days

***

## Development Process

- **TDD > Code**
  - *Enforce:* `bun test --coverage` threshold ≥ 80% in CI; mutation testing (Stryker) gate; build fails if coverage drops
- **Co-located tests > centralised test folders**
  - Tests live next to the code they test: `foo.ts` → `foo.test.ts` in the same directory. Never mirror the source tree under a top-level `__tests__/` or `tests/` folder.
  - *Enforce:*
    1. **Lefthook pre-commit** — fast local check on staged test files:
       ```yaml
       # lefthook.yml
       pre-commit:
         commands:
           colocated-tests:
             glob: "*.test.ts"
             run: |
               for f in {staged_files}; do
                 src="${f%.test.ts}.ts"
                 [ -f "$src" ] || (echo "Orphaned test (no matching source): $f" && exit 1)
               done
       ```
    2. **CI gate** — full tree scan, fails the build on any violation:
       ```yaml
       # .github/workflows/ci.yml
       - name: Enforce co-located tests
         run: |
           find src -name "*.test.ts" | while read f; do
             src="${f%.test.ts}.ts"
             [ -f "$src" ] || (echo "Orphaned test: $f" && exit 1)
           done
       ```
    3. **Biome** — ban deep relative imports from test files so a test can never reach outside its own directory:
       ```json
       // biome.json
       {
         "linter": {
           "rules": {
             "correctness": {
               "noRestrictedImports": {
                 "level": "error",
                 "options": {
                   "paths": [{ "name": "../../*", "message": "Test files must not import outside their own directory." }]
                 }
               }
             }
           }
         }
       }
       ```
- **Quality gates > Speed**
  - *Enforce:* CI stage order: `type-check → biome ci → test → mutation → SAST → build`; each stage blocks the next; no `--force` merges allowed
- **Spec-driven > Prompt-driven**
  - *Enforce:* PR template requires a spec/issue link; CI bot blocks merge if PR description is empty
- **Types > Tests > Comments**
  - *Enforce:* `tsc --strict`; Biome `noExplicitAny: error`; `noRedundantUseStrict`
  - `[ASPIRATIONAL]` Biome `noCommentedOutCode` — rule not yet available in Biome 2.x; revisit when released
- **Convention > Configuration**
  - *Enforce:* shared `biome.json` published as an internal package; all repos extend it; deviations require a `biome-ignore` comment with a justification

***

## Errors

- **Fail fast > Fail silent**
  - *Enforce:* Biome `noEmptyBlockStatements` + `useErrorMessage` to ban bare `catch {}`; every catch must log or rethrow
- **Errors are data**
  - *Enforce:* Biome `noConsole` to ban raw `console.error`; force structured logger (`logger.error({ err })`) via `noRestrictedGlobals`
- **Graceful degradation > Hard crash**
  - *Enforce:* load-test / chaos gates in staging CI; SLO burn-rate alerts as merge gates for infra changes

***

## Security

- **Secrets in env > Secrets in code**
  - *Enforce:* Gitleaks Lefthook pre-commit hook + CI scan; GitHub secret scanning enabled; `.env` files in `.gitignore` verified by CI
- **Least privilege > Convenience**
  - *Enforce:* IAM policy linter (`parliament` for AWS); OPA/Conftest policies in CI for infra-as-code PRs
- **Validate inputs > Trust callers**
  - *Enforce:* `@effect/Schema` at every API boundary; CI integration tests send malformed payloads and assert 400 responses

***

## Monitoring

- **Observe > Assume**
  - *Enforce:* CI fails if critical trace/metric instrumentation is removed (snapshot test on telemetry output)
- **Alerts on symptoms > Alerts on causes**
  - *Enforce:* SLO definitions in code (OpenSLO / Sloth); CI validates SLO YAML schema; alerts auto-generated from SLOs — never hand-crafted

***

## Docs

- **README-first development**
  - *Enforce:* CI script fails if any package directory lacks a `README.md` with a usage example
- **Docs as code**
  - *Enforce:* Biome checks Markdown via `biome ci`; broken-link checker (`lychee`) on every PR; docs reviewed with the code in the same PR
- **A diagram > 1000 words**
  - *Enforce:* `.canvas` files version-controlled; CI validates Mermaid syntax (`mmdc --check`); PR preview renders diagrams

***

## Adding a New Principle

1. State the rule.
2. Name the **Biome rule, CI script, or tool** that enforces it.
3. Wire it into Lefthook (pre-commit) **and** CI.
4. If you cannot do steps 2–3, label it `[ASPIRATIONAL]` and open a task to find enforcement before merging.
