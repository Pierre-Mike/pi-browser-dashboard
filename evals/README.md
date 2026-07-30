# Agent evals

Deterministic tooling can only prove the code is well-formed. These evals
measure the other half: **does this harness actually steer a coding agent to
build working software the canonical way — and how small a model can it
carry?**

Each cell is one `(task × model × repeat)`: a throwaway git worktree under
`$TMPDIR`, a headless `claude -p` attempt, then two independent juries.

| jury | what it proves | share of the score |
| --- | --- | --- |
| **gates** — every step `bun run verify` composes (`lint:ci`, `typecheck`, `test`, `test:web`, `test:cli`, `audit`, `axiom-debt`) | the agent did not break the repo, and stayed inside the axioms | 1 |
| **asserts** — per task, mostly real HTTP/WebSocket traffic through `evals/probe.ts` | the feature the task asked for actually exists and runs | 2 |

## Why the asserts exist at all

Because **`bun run verify` is green on an untouched checkout.** The eval this
replaced handed a task to an agent and passed it iff `verify` was green
afterwards — so an agent that edited nothing scored a perfect 1.0, and an agent
that shipped the feature scored exactly the same. The grid could not tell them
apart, which means it was measuring the repo, not the agent.

The shares are per *jury*, not per check. That is deliberate: with per-check
weights, a task with two asserts and seven gates would hand a do-nothing agent
7/(7+4) = 0.64, and adding a gate to `verify` would silently raise every task's
floor. Sharing by jury pins the do-nothing ceiling at **1/3** whatever the
counts. Prove it for yourself, for free:

```bash
bun run evals:baseline                          # whole grid, NO agent, no tokens
bun run evals:report evals/results/<runId>.json
```

The report flags any task whose **asserts** pass with nobody doing the work, and
`bun run doctor` rejects a task with no asserts at all.

## Running

```bash
bun run evals -- --suite smoke --models sonnet             # 3 tasks, cheap
bun run evals -- --suite core  --models sonnet,haiku       # 6 tasks, 2 models
bun run evals -- --suite full  --models opus,sonnet,haiku --repeats 3
bun run evals -- --tasks echo-websocket,pulse-background-job --models haiku --repeats 5
bun run evals:report evals/results/<runId>.json
bun run evals:report -- --compare evals/results/<before>.json evals/results/<after>.json
```

Useful flags: `--repeats N` (a stochastic agent needs samples), `--concurrency
N`, `--max-turns N`, `--timeout-ms N`, `--ref <git-ref>`, `--dirty` (score
uncommitted harness work — how you A/B a change to `.claude/` before committing
it), `--keep-worktrees` (post-mortem a failure), `--permission-mode`,
`--label "what changed"`, `--fail-on-red`.

Three deliberate choices in the runner:

- **The gate jury is derived, not listed.** `evals/gates.core.ts` reads the chain
  out of `verify` in package.json. Add a gate to `verify` and the grid starts
  scoring it with no edit here — the same reasoning that makes
  `scripts/typecheck.ts` derive its scope from `workspaces`.
- **`--setting-sources project`** — the agent sees only this repo's `.claude/`
  and `CLAUDE.md`, never the operator's personal skills. Otherwise the score
  measures your laptop.
- **`--permission-mode bypassPermissions`** (default) — the target is a
  disposable worktree in `$TMPDIR`, and permission friction would otherwise be
  scored as model incapability. Override it to measure the allowlist itself.

## The probe: proving a feature runs, not that words were typed

`evals/probe.ts` boots the real daemon and drives real traffic at it.

```bash
bun evals/probe.ts --path '/backoff/delay?attempt=3' --expect-status 200 | jq -e '.delayMs == 8000'
bun evals/probe.ts --steps '[{"method":"POST","path":"/checkpoints","body":{"label":"a"},"expectStatus":201},
                             {"method":"POST","path":"/checkpoints/{{0.id}}/state","body":{"state":"archived"},"expectStatus":409}]'
bun evals/probe.ts --path /ticker/stream --read-ms 1500 --expect-match-count 'data:=2'
bun evals/probe.ts --ws /echo/socket --ws-send hello --read-ms 1000 --expect-match '"echo":"hello"'
```

Two things it never does:

- **It never picks a port.** The daemon is booted with `PORT=0` — its own
  documented "let the OS pick a free port" path — and the probe reads the bound
  port back off the `daemon up: http://localhost:<port>` line. A probe that chose
  its own port could collide with a dev daemon on 8787, with `apps/web` on 5173,
  or with `apps/e2e`'s fixed 18787/15173 — and e2e's `global-setup.ts` hard-fails
  when its ports are busy, so a stray eval would break an unrelated test run.
- **It never touches your state.** Every boot gets a throwaway
  `CLAUDE_CONFIG_DIR` and projects root, a unique `PID_ZELLIJ_PREFIX` (so the
  daemon can neither attach to nor name a real zellij session), and the tunnel,
  issue poll, rules tick and terminal poll are all off. `--config-dir DIR` opts
  into a *shared* sandbox so two invocations can prove a write survives a daemon
  restart — that is how the persistence task's durability assert works.

Flags: `--path --method --body --header 'K: V' --env K=V --expect-status
200[,201] --expect-header 'k=substring' --expect-match TEXT
--expect-match-count 'TEXT=N' --read-ms N --wait-ms N --steps JSON --ws PATH
--ws-send TEXT --config-dir DIR --daemon-entry PATH`.

## The two questions this answers

**"Can this architecture express any kind of application?"** The task set spans
ten archetypes on purpose — pure algorithm, persistence + a state machine,
external HTTP with failure mapping, a `@pid/shared` contract, cross-cutting
middleware, a web query slice, background (non-request) work, SSE streaming,
WebSocket streaming, and a rename-survival stress test. A structure that only
fits request/response CRUD shows up as a column of zeros on `ticker-sse-stream`,
`echo-websocket` and `pulse-background-job` — which is a finding about the
*architecture*, not about the model.

**"How cheap a model can I run?"** The report ranks models by mean score and by
**cost per point**, so a model that is 10× cheaper but fails half the grid stops
looking cheap. Strong determinism should let a smaller model succeed; the grid
tells you exactly which archetypes it stops being able to carry.

## Reference run

**Not measured yet on this harness.** The table below is the record to fill in
with `bun run evals`; the canon's model-routing paragraph ("Pick the model tier
from the grid", CLAUDE.md / AGENTS.md) points here. Numbers measured on another
repo's harness do not transfer — different gates, different tasks, different
asserts.

| model | cells | fully green | mean score | ±σ | $/cell | $/point |
| --- | --- | --- | --- | --- | --- | --- |
| opus | – | – | – | – | – | – |
| sonnet | – | – | – | – | – | – |
| haiku | – | – | – | – | – | – |

Fill it in like this, and record σ so the next A/B has a noise floor:

```bash
bun run evals -- --suite full --models opus,sonnet,haiku --repeats 1   # the grid
bun run evals -- --suite core --models haiku --repeats 3               # cheap-tier reliability
bun run evals:report evals/results/<runId>.json
```

Then update this section **and** the canon paragraph in the same commit. A number
nobody re-measures is worse than no number.

## Adding a task

One JSON object per line in `tasks.jsonl`:

```json
{
  "id": "kebab-id",
  "archetype": "what shape of app this exercises",
  "difficulty": "easy | medium | hard",
  "suites": ["core", "full"],
  "prompt": "… Finish by running `bun run verify` and fixing any failures.",
  "asserts": [{ "name": "human-readable claim", "run": "shell command, exit 0 = pass" }]
}
```

Rules that keep the grid honest:

1. **Every task needs at least one assert** (`bun run doctor` enforces this) —
   otherwise the task is free points.
2. **No assert may pass before the agent starts.** Run `bun run evals:baseline`
   after adding one — the first baseline run of this grid caught five asserts
   that were green with nobody doing the work, and dragged the floor from 0.33
   to 0.41. Two shapes cause it, and both are easy to write by accident:
   - a **negative** grep over a file that does not exist yet
     (`! grep -q fetch new/slice.ts` passes when `new/` is empty) — put
     `test -f <file> &&` in front of every one;
   - a **regression guard** ("`/health` stays public", "the endpoint still
     answers") — chain it onto the positive proof inside a single assert
     (`… && …`) instead of shipping it as its own point.
3. **Prefer a functional assert over a grep.** A grep proves an agent typed the
   right words; the probe proves the feature answers. Grep for *structure* (where
   the `fetch` lives, whether the core reads a clock) and probe for *behaviour*.
4. **Pin exact expected values in the prompt** — a number, a status code, an
   error tag — so the assert can be exact instead of fuzzy.
5. **End the prompt with** "run `bun run verify` and fix any failures", so the
   gate jury stays part of the judgement.

## Interpreting a run

`evals/report.ts` prints a model table, a task × model matrix, and the checks
that failed. For a harness change use `--compare`: the verdict is `improved` /
`regressed` / `noise` against a **2σ noise floor** computed from the repeats
(with fewer than two repeats per side it demands a blunt ±0.1 gap instead of
trusting one sample). Score up → keep the change and ratchet the floor. Sustained
drop → revert. Inside the noise → you have not learned anything yet; add
repeats.

Before reading a single red cell as "this model cannot do X", re-run it:
`--tasks <id> --models <m> --repeats 3 --keep-worktrees` keeps the worktrees so
the failure can be opened up.

The scoring maths (`evals/score.core.ts`), the probe's judgements
(`evals/probe.core.ts`) and the gate derivation (`evals/gates.core.ts`) are pure
and unit-tested, run inside `bun run test`, and are covered by the same
core-purity lint rules as the product code — the harness that judges the agent is
itself judged by the repo's own gates.

CI runs the grid weekly (`.github/workflows/evals.yml`). The free baseline step
runs on every trigger; the paid grid no-ops when `ANTHROPIC_API_KEY` is absent.
