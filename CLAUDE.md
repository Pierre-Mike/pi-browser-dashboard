# CLAUDE.md — pi-browser-dashboard

Agent operating rules for this repo.

`AGENTS.md` carries the project's own story: what the daemon does and does not
do, the session-state and orchestration decisions, the API surface, the pid-apps
and CLI distribution notes, and the per-directory expertise index. Read it for
*this* product. Read the canon below for *how we build*.

Its `## Domain` section is the product's vocabulary, and two of its distinctions
have already cost us bugs: a **short** is not a `sessionId`, and the
**supervisor reading** of a session (`state.json`) is not its **screen reading**
(what the matcher table saw) — they are independent and may contradict. Read the
section before naming anything; the `_Avoid_` lists are near-synonyms we refuse,
not names in use. The glossary lives only in `AGENTS.md`, never copied here.

<!-- CANON:START -->
## Engineering canon

Everything between the `CANON` markers is shared verbatim between `CLAUDE.md`
and `AGENTS.md`; `bun run doctor` fails the build if the two copies drift. Edit
both files together.

Every rule below is enforced by a tool. If you find yourself fighting one, fix
the design, not the linter.

### Architecture: feature-first vertical slices

Code is organized by **feature**, not by layer. Each slice owns its full vertical:

```
apps/daemon/src/
  features/<feature>/
    <feature>.core.ts        # PURE domain logic — no I/O, no Effect runtime
    <feature>.core.test.ts   # co-located unit test (data-in / data-out)
    <feature>.io.ts          # I/O as an Effect service (Context.Tag + Layer)
    <feature>.routes.ts      # Hono shell; impure read -> pure core -> respond
    <feature>.door.ts        # opt-in: the ONLY file another slice may import
  platform/                  # cross-cutting infra (runtime, config, ws, sse-bus)
  api.ts                     # assembles routes; exports AppType for hc RPC
  server.ts / main.ts        # composition root (Bun.serve, live Layers)
shared/src/                  # effect Schema wire contracts (doors re-export them)
apps/web/                    # Vite + React + TanStack Router (UI only) + Query
apps/cli/                    # `pid-dashboard` single-binary distribution
apps/e2e/                    # Playwright end-to-end suite
scripts/                     # the harness: gate scripts + their co-located tests
evals/                       # golden agent tasks; the repo's gates are the judge
```

`platform/` is for infra shared across slices. Anything feature-specific lives
in its slice. Anything a *second workspace* needs goes in `shared/`.

### The impureim sandwich (critical)

- **`*.core.ts` is pure.** Failures are values: `Either<A, E>`, `Option`, or a
  `Data` tagged union. Typed errors YES — but **NO** `throw`, no `await`, no
  `Effect` / `Layer` / `Context`, no clock, no environment, no I/O. `Either`,
  `Option`, `Data` and `Schema` from `effect` are allowed.
- **`*.io.ts` / `*.routes.ts` / `server.ts` use Effect.** Services are
  `Context.Tag`s, wiring is `Layer`s, the runtime is a `ManagedRuntime`.
- **Lift the core into Effect at the boundary.** A route reads I/O (impure),
  calls the pure core (the sandwich filling), responds. An `Either` returned by
  a core can be `yield*`-ed inside `Effect.gen` — a `Left` short-circuits as a
  typed failure.
- **`*.io.ts` is the slice's I/O port** (hexagonal sense) — any effectful
  dependency: subprocess spawn, filesystem, HTTP, clock. Not just persistence.
  That breadth is why the tier is named `io` and not `repo`, and it keeps the
  word "repo" free for what it means in this domain: a git repository.

Biome enforces this by file shape: in `**/*.core.ts` the imports
`Effect`/`Layer`/`Context` and any `*.io` or `*.door` module are banned, the
globals `Date` / `process` / `Promise` / `console` / `setTimeout` /
`setInterval` / `fetch` are banned, and three GritQL plugins
(`biome-plugins/`) ban `throw`, `await`, and 2+ positional parameters on a
declaration.

### Axioms, and the tool that enforces each

- **Failures are values in the core.** `biome-plugins/no-throw-in-core.grit`
  bans `throw`; `no-await-in-core.grit` bans `await`. Return
  `Either.left(...)` and let the shell decide whether that is a 400, a retry or
  a log line.
- **Co-located tests.** `*.test.ts` next to its source, never a `__tests__/`
  folder. `scripts/check-colocated-tests.ts` requires a sibling
  `*.core.test.ts` for every `*.core.ts` and rejects mirrored test directories.
  `scripts/check-feature-tests.sh` additionally requires every feature folder to
  ship at least one test.
- **TDD at three layers.** Pre-commit (`scripts/check-tests-touched.sh`) blocks
  a commit touching `apps/*/src/**` with no staged test — bypass with
  `SKIP_TDD=1` for docs/deps/config only. Pre-push runs the typecheck, the debt
  ratchet, the unit suites and the full Playwright suite, so a red branch never
  reaches the remote (`SKIP_E2E=1` to skip e2e). The PR e2e workflow re-runs
  Playwright and posts per-test screenshots as a sticky PR comment.
- **Everything type-checks.** `scripts/typecheck.ts` derives the project list
  from root `package.json` `workspaces` and runs `tsc --noEmit` on each; a
  workspace *without* a `tsconfig.json` is an error, not a skip. It reads
  `workspaces` rather than globbing `apps/*` for a concrete reason: `shared/` is
  a workspace and not an app, and under an `apps/*` scan it escaped both this
  gate and the debt ratchet. Whatever you must declare to make the repo install,
  you cannot exempt from the gates. `scripts/check-axiom-debt.ts` derives its
  scan roots the same way, and `bun run doctor` fails if either stops doing so.
- **No raw `fetch`, no `axios`.** `noRestrictedImports` bans `axios`
  repo-wide; the web app talks to the daemon through the typed Hono RPC client
  (`api = hc<AppType>` in `apps/web/src/lib/api.ts`). `*.io.ts` is the sanctioned
  place for a raw request.
- **Contracts live in `shared/`; the mirrors that survive are guarded, not
  silent.** A type two workspaces need is declared **once**, in `shared/src`, as
  an effect `Schema` — so the same declaration both types a call site and decodes
  an untrusted response (`decodeSessionState`, `decodeProject`,
  `decodeApiErrorBody`; `onExcessProperty: "error"`, so an undocumented field
  fails loudly instead of surfacing as `undefined` three components deep). Never
  hand-copy a daemon type into the web app. That is not a hypothetical:
  `SessionState` and `Project` were each declared twice, the second time in
  `apps/web/src/lib/types.ts` under a comment calling the copy a "local mirror",
  and both mirrors had already drifted — missing `worktreePath`,
  `worktreeBranch` and `lastCommitMs`, and typing nine nullable fields as
  required `string`. Nothing could have caught it, because there was no single
  declaration for the two copies to disagree with. Both web mirrors are gone;
  `apps/web/src/lib/types.ts` re-exports from `@pid/shared`.
- **Two declarations are fine when each has a job the other cannot do and
  something proves they agree. They are a mirror when nothing does.** That line,
  not the count, is the test to apply — and the two daemon-side pairs that remain
  sit on opposite sides of it, so the rule comes with worked examples.
  `SessionState` is declared twice on purpose: `shared/src/session.ts` models
  *wire* optionality (`S.optional`, because `JSON.stringify` drops an `undefined`
  key and the field never reaches the body), while
  `features/sessions/sessions.core.ts` keeps a strict producer type where every
  key is required, so a constructor that forgets one is a type error. Neither job
  is the other's, and `features/sessions/sessions.contract.test.ts` is the proof
  they agree — it JSON round-trips real `parseState` / `seedFromWorker` output
  through `decodeSessionState` and goes red on a daemon field the contract does
  not know about. `Project` fails both halves: `shared/src/project.ts` and
  `features/projects/projects.io.ts` declare the same ten fields with the same
  optionality, so neither is doing work the other cannot, and nothing compares
  them — drift surfaces only when the web app decodes a live response. That pair
  is a mirror, and naming it here is deliberate: a gap with an address gets
  closed, a gap acknowledged in general does not. Add the contract test or delete
  the duplicate; either way, do not add a third copy of either type.
- **`shared/` dissolved a deadlock the ratchet created.** A core that needed
  another slice's vocabulary used to keep a *literal copy* of it, because
  importing across slices is debt. Five such copies existed — the session-state
  slugs in `features/fleet`, `features/rules` and the CLI's agent core, the
  named-key list in `features/rules`, and the wait/staleness timings — each with
  a comment apologising for itself. Those five are gone:
  `shared/src/{session,keys,timing}.ts` holds one declaration each, importable
  from a pure core at zero debt. `scripts/mirrored-constants.test.ts`, the file
  that compared them, still exists and still runs, because two copies outlived
  the cleanup: the screen-vs-supervisor agreement table, duplicated between
  `features/sessions/sessions-explain.core.ts` and
  `apps/web/src/features/terminal/terminalState.ts` because neither workspace may
  import the other, and the zellij session name one slice mints while another
  resolves it. That file lives under `scripts/` so it can import both sides
  without adding cross-slice debt, and it is where an unavoidable copy earns the
  right to exist: a mirror with an assertion attached, not a mirror with an
  apology.
- **Contracts decode at the boundary.** `biome-plugins/no-cast-json.grit` bans
  `(await res.json()) as T` — a cast asserts a wire shape without checking it, so
  drift compiles forever and fails at runtime. Hand the decoded `unknown` to the
  shared `decode*` helper, or to a local pure parser for a shape that is
  genuinely one workspace's own. The ban covers **every** workspace; `bun run
  doctor` fails if its scope is narrowed, because the debt class that used to
  cover `apps/web` has been retired and nothing else is watching.
- **One error shape.** A failure crosses HTTP as `{ error: "<machine_tag>", … }`
  — the `ApiErrorBody` contract in `shared/src`. Tags are snake_case and stable;
  clients branch on them. A scaffolded slice maps its tags in a
  `STATUS_BY_ERROR` allowlist typed by its error union, so adding a failure mode
  without giving it a status is a type error rather than an inherited 500.
- **Typed config at boot.** `platform/config.io.ts` (plus `config-dir.ts` and the
  composition roots) is the one place that reads `process.env`. Slices receive
  values; they do not fetch them.
- **Log through the runtime, not `console`.** `noConsole` is an error outside the
  composition root and tests.
- **One parameter on declarations you design.**
  `biome-plugins/max-one-param-declarations.grit` bans 2+ positional parameters
  on named declarations — pass a single options object so the signature stays
  narrow as the implementation deepens. Scoped to `scripts/**` *and* to every
  `**/*.core.ts`: a shape, not a directory, so a new slice or a renamed app
  inherits it. Callback shapes a library dictates (`sort((a, b))`, Hono's
  `(c, next)`) are exempt by construction. `complexity/useMaxParams: max 2` is
  the floor everywhere.
- **Modules talk through doors, not back-channels (modular monolith).** A slice
  may import another slice's *published* door, never its internal files — and
  the door is a **file**: `<feature>.door.ts`, inside the slice that publishes
  it. Ownership stays with the module fronting the code, and it is the one
  cross-slice path `bun run axiom-debt` leaves open. It re-exports that slice's
  service `Context.Tag` and its interface type, plus the `shared/` `Schema`
  contract for the data crossing it, so a consumer has one import site and
  nothing else in the slice is reachable from outside. Naming the file matters
  more than it looks: with the boundary enforced but its shape unspecified, the
  template this canon comes from watched three models invent three conventions
  for the same task — a door in the slice, a door in `shared/`, and a narrowed
  port schema — so three PRs would have left three patterns behind.
  `bun run scaffold:slice <feature> --door` stamps one out. Opt-in, because a
  door nobody imports yet is an unused export that `fallow audit` calls dead
  code: publish one and wire the consumer in the same change. A pure
  `*.core.ts` may not import a door at all — a door re-exports a `Tag`, so
  consuming one would drag the Effect runtime into pure code past the ban on
  `effect` itself, and biome bans it by shape. Compose every module's live
  `Layer` into one process by default; a module becomes a separate deployment
  only under real pressure, and because consumers depend on the `Tag`, that
  split swaps a `Layer` at the composition root, not call sites. Design as if
  distributed; deploy as if together.
- **Conventional commits.** `type(scope)?: subject` — the lefthook `commit-msg`
  hook (`scripts/check-commit-msg.ts`) rejects anything else.
- **Dead code, cycles and duplication are audited.** `fallow audit`
  (`bun run audit`) runs in CI and pre-push, grading complexity and duplication
  against the committed snapshots in `.fallow-baselines/` so a large rename
  cannot re-attribute inherited debt to the PR that only moved filenames
  (`bun run audit:baseline` refreshes them).
- **Mutation tests grade the assertions.** `bun run test:mutation` mutates every
  `*.core.ts`; line coverage says a line ran, a surviving mutant says nothing
  asserted its behaviour. Weekly in CI, not per-PR — it costs minutes.
- **The bundle is built in CI, not only type-checked.** `verify` asks `tsc`
  whether the import graph type-checks; it never asks a *bundler* to resolve it,
  and those are different questions — `apps/web` imports `@pid/shared` at
  runtime, and tsc is happy with a workspace symlink a bundler might not be. The
  `build:cli (bundle resolves)` job builds the real distribution artifact on
  every PR, so a resolution failure surfaces there rather than at release time.
- **The supply chain is pinned and scanned.** Every `uses:` in every workflow is
  pinned to a full commit SHA — a tag is mutable, and whoever controls it
  controls what runs inside a job that already holds a token. `bun run doctor`
  checks pinning across **every** file in `.github/workflows`, discovered from
  disk, so a newly added workflow cannot skip the rule. The bun version lives in
  `.bun-version` and nowhere else. CodeQL and `zizmor` (workflow-security lint)
  run in CI; Dependabot proposes grouped weekly updates.

### Scaffold a slice; never hand-copy one

```bash
bun run scaffold:slice <feature>            # kebab-case
bun run scaffold:slice <feature> --door     # …plus its published door
```

Writes the five slice files in canonical shape (pure core + test, `Context.Tag`
io port with live *and* test Layers, Hono routes + test), mounts the route in
`api.ts`, and registers the live `Layer` in `platform/runtime.ts`. `bun run
verify` passes immediately afterwards, so any failure you then see is yours.
`--door` adds `<feature>.door.ts` on top — ask for it only when you are about to
wire the consuming import, since an unconsumed door is dead code.

A written recipe is advice and decays; every hand-copied slice drifts a little
from the last one. Generating the shape makes the canonical form the *cheapest*
one to produce. See `.claude/skills/add-slice`.

### Axiom debt is ratcheted, never waived

Three axioms are violated in bulk by code that predates their enforcement, so
turning them into hard lint errors today would fail CI: cross-slice internal
imports, `process.env` reads outside the config funnel, and raw `fetch`.

Rather than documenting them and hoping, `scripts/axiom-debt.json` records the
exact per-file counts and `bun run axiom-debt` fails on **any** difference — a
new violation *or* a repaid one. New code therefore cannot add debt silently,
and every repayment lands as a smaller number in a reviewable diff:

```bash
bun run axiom-debt          # gate (CI + pre-push)
bun run axiom-debt:update   # after paying some down; commit the new baseline
```

**A ratchet is meant to end.** There were four classes; `json-cast` was the
fourth, with ~40 sites in `apps/web` that had nothing to decode against. Once
`shared/` existed those were paid off, `no-cast-json.grit` was widened to every
workspace, and the class was **deleted** — a lint rule cannot be paid back down,
so it needs no ratchet. That is the intended end state for each of the three
that remain: drive the count to zero, then replace the class with the rule.

### Evals and retrospectives close the loop

Tests and lint verify deterministic code. **Evals** verify the non-deterministic
half — including the harness itself. `evals/` is a grid of
`task × model × repeat`: each cell hands one task to a headless agent in a
throwaway worktree, then judges it twice. The repo's own gates — every step
`bun run verify` composes, *derived* from package.json rather than listed — prove
nothing broke; per-task **asserts**, mostly real HTTP and WebSocket traffic
through `evals/probe.ts`, prove the feature actually runs.

The asserts are worth **twice** the gates, and that ratio is the whole point:
`bun run verify` is green on an untouched checkout, so the gates-only eval this
replaced scored an agent that changed nothing a perfect 1.0. The shares are per
*jury*, not per check, which pins the do-nothing ceiling at 1/3 however many
gates or asserts a task happens to have. `bun run evals:baseline` runs the entire
grid with **no agent** — free, and the only honest way to ask what a task is
worth before the work is done. `bun run doctor` rejects a task with no asserts,
and the report flags any assert that is already green before the agent starts.

The task set spans application *archetypes*, not just CRUD — pure algorithm,
persistence + state machine, external HTTP failure mapping, a `@pid/shared`
contract, cross-cutting middleware, a web query slice, background (non-request)
work, SSE, WebSocket, rename survival — so a structure that only fits one shape
shows up as a column of zeros. `evals/report.ts --compare` answers *did my
harness change help?* against a 2σ noise floor built from the repeats, never a
single run: score up → keep it and ratchet the floor; a sustained drop → revert.
Weekly in CI (`.github/workflows/evals.yml`); the free baseline always runs, the
paid grid no-ops without an `ANTHROPIC_API_KEY`.

When a change to `CLAUDE.md`, a skill, a hook or a gate makes agents start
failing these tasks, the harness regressed: fix the harness, not the task.

`/retro` (`.claude/skills/retro`) is the diagnosis step. It mines the git
history, merged PRs and the gate output into a few ranked, **enforcement-biased**
proposals — prefer a hook, lint rule, test or script over a written guideline,
because enforcements compound and guidelines decay. Loop: `/retro` proposes →
apply → re-run the evals → keep what raises the score.

### Pick the model tier from the grid, not from habit

Strong determinism is supposed to buy a cheaper model, and the grid is what says
where it actually does: `evals/report.ts` ranks each tier by mean score **and by
cost per point**, so a model that is 10× cheaper but fails half the grid stops
looking cheap. Route per *archetype*, because that is where tiers diverge —
structural work inside a shape the scaffolder already stamps out is a different
task from behaviour that has to be live-correct (background work, upstream
failure mapping, streaming; anything whose proof is a round-trip rather than a
type).

**The numbers for this repo are not measured yet.** Measure them with
`bun run evals -- --suite full --models opus,sonnet,haiku`, record the table and
its σ under "Reference run" in `evals/README.md`, and update this paragraph in
the same commit. Do not import another repo's figures: a score is a property of
*this* harness — its gates, its tasks, its asserts — not of the model alone.
Re-measure after a harness change or a new model release, and before concluding a
tier cannot do something, re-run that cell with `--repeats 3`: a single red cell
is often variance, which is why the noise floor exists at all.

### The harness checks itself

Enforcement attaches to file *shape* (`**/*.core.ts`, `**/*.io.ts`,
`**/features/**`), not to a path: denials are global, allows are sanctioned
shapes, so renaming or adding an app cannot make a rule quietly stop applying.

`bun run doctor` (`scripts/check-harness.ts`, inside `bun run test`) then
asserts the enforcement stack itself: grit plugins referenced and present, the
core-purity override still scoped by shape and still denying every listed
global, the one-param plugin still covering the cores, the cast ban still
covering every workspace, lefthook jobs wired, gate scripts composed into `test`
and `verify`, every workspace inside the typecheck, the two gate scripts still
deriving their scope from `workspaces`, every workflow's actions pinned to commit
SHAs, the canon block in sync — and the literal CI job names the branch ruleset
requires as status checks. Deleting a gate is a deliberate, visible act that
fails CI, not silent drift.

Its own inputs are *discovered*, never listed: workspaces from `package.json`,
workflows from the directory, plugins from a glob. A hand-maintained list inside
the checker would fail open in exactly the way the checker exists to prevent.

**Being offline is the one hole doctor cannot close about itself.** It validates
the *committed* `.github/rulesets/main.json` against the job names the workflows
declare, but it cannot ask GitHub whether that file still describes reality — so
branch protection edited through the web UI leaves the committed contract stale
in silence, every gate stays green, and this checker goes on validating a
contract nobody enforces. `.github/workflows/ruleset-drift.yml` closes it from
the other side, on a cron for the same reason `bun audit` is on one: drift
arrives on someone else's clock, not on our PR traffic. It reconciles live
against committed, opens or refreshes ONE deduped `governance` issue and closes
it when they agree again — never a red run, because a permanently red cron badge
becomes wallpaper, and reconciling is a real decision that may take days
(sometimes the UI edit is the correct one and the *file* is what should change).
It fails only when the comparison itself fails, which must never be readable as
agreement. The comparison is semantic, not textual: the live payload is
projected onto the shape the committed file declares and both sides are
canonically sorted, because a `jq -S`-grade compare would report drift every day
over key ordering alone and be muted inside a week. Reading a ruleset needs no
admin — only *writing* one does, which is why `apply-ruleset.sh` is human-run and
this is not. `bun run doctor` asserts the watch by shape (a cron trigger and the
drift comparison in one workflow), so renaming the file is fine and deleting the
step is not.

**Do not rename the `lint` / `bun-test` job display names in
`.github/workflows/unit-tests.yml`.** The branch ruleset pins its required
status checks to the exact strings `biome ci (lint + format)` and
`bun test (daemon + web)`; renaming one makes every PR unmergeable ("the base
branch policy prohibits the merge") while every visible check is green. Update
the ruleset first. `bun run doctor` guards those two strings.

### Gate commands

```bash
bun install            # installs + wires git hooks (lefthook)
bun run verify         # lint:ci + typecheck + test + web/cli suites + audit + axiom-debt
bun run lint           # biome check --write .   (autofix)
bun run lint:ci        # biome ci .              (CI gate)
bun run typecheck      # tsc --noEmit over every workspace
bun run test           # colocation + doctor + daemon + shared + scripts + evals suites
bun run test:web       # web unit suite
bun run test:cli       # cli unit suite
bun run test:shared    # shared contract suite
bun run test:e2e       # playwright (apps/e2e)
bun run test:mutation  # stryker over *.core.ts (also weekly in CI)
bun run audit          # fallow: dead code / duplication / cycles / complexity
bun run doctor         # harness self-check (also inside `test`)
bun run axiom-debt     # ratchet on the four debt classes
bun run scaffold:slice # generate a feature slice in canonical shape
bun run scaffold:theme # generate a daisyUI theme family, contrast solved
bun run theme:check    # the four theme gates only — the inner loop, ~0.1s
bun run evals          # graded agent grid (needs ANTHROPIC_API_KEY)
bun run evals:baseline # the same grid with NO agent — free, and keeps it honest
bun run evals:report   # score a run, or --compare two against the noise floor
bun run dev            # daemon (:8787) + web (:5173)
```

### How to add a feature slice

1. `bun run scaffold:slice <feature>` — never hand-copy an existing slice. Add
   `--door` when another slice will consume this one; it also emits
   `<feature>.door.ts`, the slice's published surface.
2. Grow the pure decision logic in `<feature>.core.ts` + its co-located test.
   If the rule is data-in/data-out, it belongs in the core, not in a handler.
3. Replace the stub I/O in `<feature>.io.ts`. Keep `<Feature>IoTest` in step
   with the live Layer; the route test runs the real handlers over it.
4. Widen `<Feature>Error` *and* `STATUS_BY_ERROR` together for each new failure
   mode.
5. Promote any type `apps/web` also needs to `shared/src` as a `Schema`, and
   re-export it from `shared/src/index.ts`. Do not hand-copy it.
6. (web) add the query hook and route under `apps/web/src/features/<feature>/`,
   going through the typed RPC client and decoding with the shared helper.
7. `bun run verify`.
<!-- CANON:END -->
