---
name: pr-automerge
description: >
  Create a pull request after completing all code changes, then enable auto-merge
  so the PR merges automatically once CI/CD passes. Use when the user asks to
  "open a PR and auto-merge", "ship this", "create a PR and merge when green",
  "merge after CI passes", or any request that implies opening a PR and letting
  it merge itself on a green build. Activates after a set of changes is committed
  and pushed and the work is ready for review/merge.
---

# PR + Auto-merge

## When to use

After all changes for a task are complete, committed, and pushed. Goal: open one PR and let GitHub merge it automatically when required CI/CD checks pass.

## Procedure

1. Verify clean state — all intended changes committed:
   ```bash
   git status
   ```
   If uncommitted changes remain, commit and push them first (see `commit-push`).

2. Push the branch to the remote (set upstream if new):
   ```bash
   git push -u origin HEAD
   ```
   Never open a PR from the default branch — branch first if on `main`.

3. Create the PR with `gh`:
   ```bash
   gh pr create --fill
   ```
   Use `--title`/`--body` instead of `--fill` when a structured description is warranted. End PR bodies with the Claude Code attribution line.

4. **Preflight: confirm CI actually gates the merge.** `gh pr merge --auto` only waits when the base branch has a *required* status check (branch protection). With no required checks, GitHub treats the PR as mergeable and `--auto` merges **immediately** — defeating the purpose. Check first:
   ```bash
   gh api "repos/{owner}/{repo}/branches/$(gh pr view --json baseRefName -q .baseRefName)/protection/required_status_checks" 2>/dev/null
   ```
   - Exit 0 with a `contexts`/`checks` list → required checks exist. `--auto` will gate correctly; go to step 5a.
   - Non-zero / `Not Found` / empty → **no required checks**. `--auto` would merge instantly. Go to step 5b.

5. Gate the merge on CI:

   **5a. Required checks exist — native auto-merge:**
   ```bash
   gh pr merge --auto --squash
   ```
   GitHub holds the merge until the required checks pass.

   **5b. No required checks — gate behaviorally.** Wait for the PR's checks to reach a terminal state, then merge only if green. Do *not* arm `--auto` (it would merge now):
   ```bash
   gh pr checks --watch --fail-fast   # blocks until all checks finish; non-zero if any fail
   gh pr merge --squash               # only runs if the watch exited 0
   ```
   - If a check fails, `gh pr checks` exits non-zero and the merge is skipped — report the failing check, do not merge.
   - If the PR has **no checks at all**, `gh pr checks` reports none; there is nothing to gate on. Tell the user and merge only with their go-ahead.

   - `--squash` is the default merge strategy. Use `--merge` or `--rebase` only if the repo requires it.
   - If `gh` reports auto-merge is not allowed on the repo, report that to the user — do not fall back to an immediate, ungated merge unless they ask.

6. Report back: PR URL, the merge strategy, whether the merge was gated by required checks (5a) or by watching checks (5b), and the final CI/merge outcome.

## Guardrails

- Never let an ungated merge masquerade as auto-merge. `--auto` on a repo with no required checks merges immediately — always run the step-4 preflight and switch to the 5b watch path when no required checks exist.
- Do not bypass branch protection or use admin override flags.
- If a repo has no checks at all, there is nothing gating the merge; warn the user explicitly and get their go-ahead before merging.
- Optional hardening: suggest the user add a required status check via branch protection so native `--auto` can do the gating going forward.
