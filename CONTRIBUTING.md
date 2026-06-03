# Contributing

Thanks for your interest. This file covers the day-to-day: how to set up,
where to put code, what the tests must look like, and how a PR lands.

For architecture and the rationale behind stack choices, read `AGENTS.md`.

## Setup

```bash
bun install   # also wires git hooks via `prepare` → `lefthook install`
bun run dev   # daemon + web together
```

You need Bun ≥ 1.1 and the Claude Code CLI signed in at least once. See the
README for the full requirements list.

## Branch + PR flow

1. Branch from `origin/main` (not a stale local HEAD).
2. Make the change. Add or update tests in the same commit — the pre-commit
   hook will block you otherwise.
3. Push. Pre-push runs `bun run test` and `bun run test:e2e`. A red branch
   never reaches the remote.
4. `gh pr create --base main` (or via the GitHub UI). PR e2e runs in CI and
   posts a sticky comment with screenshots.
5. Squash-merge once green. Conventional commit prefix in the title
   (`feat`, `fix`, `chore`, `test`, `docs`, `refactor`).

> The repo has no required-checks branch protection (private repo on the
> free plan). `gh pr merge --auto` will fire the instant a PR is mergeable —
> **don't queue it on a draft until CI is green**. The host-level
> `triage.sh` loop already enforces "ready + auto-merge only after green",
> so let it handle promotion for issue-driver PRs.

## Code style

- **Biome** is the linter and formatter. Run `bun run lint` before pushing,
  or rely on the pre-commit `stage_fixed: true` step.
- **TypeScript strict**, `noUncheckedIndexedAccess`, no `any`, no
  `console.log` (use `console.error` / `console.warn` when needed), no `as`
  casts outside tests — decode at the boundary with `@effect/schema`.
- **Effect-TS** for error handling, DI, concurrency. No `try/catch`, no mock
  frameworks.
- **Functional Core / Imperative Shell** suffix discipline in the daemon:
  - `*.core.ts` — pure logic, fully tested
  - `*.repo.ts` — side-effects (fs, shell, network)
  - `*.routes.ts` — HTTP boundary
- **Co-located tests**: `foo.ts` → `foo.test.ts` next to it.
- **Named parameters** for any function with 3+ args.
- **Immutability by default** (`readonly`, `as const`).

## Tests are mandatory

Every behavior change ships with a test. The pre-commit gate enforces it.
Bypasses (`SKIP_TDD=1`, `--no-verify`) are for docs / dep bumps / config
only — flag the reason in the commit message if you use them.

- Unit: `bun test` in `apps/daemon/` (also via `bun run test` at root).
- e2e: Playwright under `apps/e2e/`. Run `bun run test:e2e:ui` for the
  interactive runner.

## Issues + features

- Bugs: open an issue with the bug template. Include version, reproduction
  steps, and what you expected.
- Features: open an issue describing the use case before sending a PR for
  anything non-trivial — saves a round trip if the idea doesn't fit the
  thin-daemon shape (see `AGENTS.md` → "What this daemon does NOT do").

## Conduct

Be respectful, be specific, attack ideas not people. Maintainers may close
or remove anything that doesn't meet that bar.
