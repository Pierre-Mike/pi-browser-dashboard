#!/usr/bin/env bash
# Prune worktree-* branches whose changes are already on main (incl. squash-merges)
# and remove their .claude/worktrees/ checkouts.
#
#   scripts/prune-merged-worktrees.sh           # dry-run: list what would be pruned
#   scripts/prune-merged-worktrees.sh --force   # actually delete branches + worktrees
#
# A branch is "merged" if either:
#   - it has 0 commits ahead of main, OR
#   - `git cherry main <branch>` reports every commit as already-applied ('-' lines only)
#     — this catches squash-merged branches whose SHAs were rewritten.
set -euo pipefail

BASE="${BASE:-main}"
FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

git rev-parse --verify --quiet "$BASE" >/dev/null || { echo "base branch '$BASE' not found" >&2; exit 1; }

current="$(git symbolic-ref --quiet --short HEAD || echo)"
pruned=0

while IFS= read -r branch; do
  [[ -z "$branch" ]] && continue
  [[ "$branch" == "$BASE" || "$branch" == "$current" ]] && continue

  ahead="$(git rev-list --count "$BASE..$branch")"
  merged=0
  if [[ "$ahead" -eq 0 ]]; then
    merged=1
  elif ! git cherry "$BASE" "$branch" | grep -q '^+'; then
    # cherry prints '+' for commits NOT in base; none → all already applied (squash-merged)
    merged=1
  fi
  [[ "$merged" -eq 0 ]] && continue

  wt="$(git worktree list --porcelain | awk -v b="refs/heads/$branch" '
    /^worktree /{path=$2} /^branch /{if($2==b) print path}')"

  if [[ "$FORCE" -eq 1 ]]; then
    [[ -n "$wt" ]] && git worktree remove --force "$wt" 2>/dev/null || true
    git branch -D "$branch" >/dev/null
    echo "pruned  $branch${wt:+  ($wt)}"
  else
    echo "would prune  $branch  (${ahead} ahead)${wt:+  worktree: $wt}"
  fi
  pruned=$((pruned + 1))
done < <(git for-each-ref --format='%(refname:short)' refs/heads/worktree-*)

if [[ "$pruned" -eq 0 ]]; then
  echo "no merged worktree-* branches to prune"
elif [[ "$FORCE" -eq 0 ]]; then
  echo "---"
  echo "$pruned branch(es) would be pruned; re-run with --force to delete"
fi
