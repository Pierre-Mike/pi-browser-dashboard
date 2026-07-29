#!/usr/bin/env bash
LOG="$(dirname "$0")/../auto-pr.log"
exec >>"$LOG" 2>&1
echo "[$(date -u +%FT%TZ)] event=$1 cwd=$(pwd)"
case "$(pwd)" in */.claude/worktrees/*) ;; *) echo "skip: not worktree"; exit 0 ;; esac
command -v gh >/dev/null || { echo "skip: no gh"; exit 0; }
branch="$(git rev-parse --abbrev-ref HEAD)"
[ -z "$branch" ] || [ "$branch" = HEAD ] || [ "$branch" = main ] && { echo "skip: branch=$branch"; exit 0; }
git fetch origin main --quiet
ahead="$(git rev-list --count origin/main..HEAD 2>/dev/null || echo 0)"
[ "$ahead" -gt 0 ] || { echo "skip: ahead=0"; exit 0; }
# "ahead of main" is not the same as "has work of its own". A branch stacked on
# another unmerged branch inherits every one of its parent's commits, so it is
# ahead while containing nothing new — and opening a PR for it means merging the
# parent's work under this branch's name. On 2026-07-29 that landed one feature
# five times (#441-#445) and another twice (#438/#439).
#
# The test is exact tip equality, NOT `--contains`: a ref that *contains* HEAD is
# usually a child branch stacked on this one, and skipping on that would silence
# the parent — the branch actually doing the work. Two refs at the identical
# commit are indistinguishable in git; whichever of them is "real" gets its PR on
# its next commit, or from an explicit `gh pr create`.
twin="$(git for-each-ref --format='%(refname)' --points-at HEAD refs/heads refs/remotes 2>/dev/null \
  | grep -v -e "^refs/heads/$branch$" -e "^refs/remotes/[^/]*/$branch$" | head -1)"
if [ -n "$twin" ]; then echo "skip: no commit of its own (HEAD is also $twin)"; exit 0; fi
existing="$(gh pr list --head "$branch" --state open --json number --jq length 2>/dev/null || echo 0)"
[ "$existing" = 0 ] || { echo "skip: PR exists"; exit 0; }
git push -u origin "$branch" || { sleep 2; git push -u origin "$branch"; } || { echo "fail: push"; exit 0; }
gh pr create --base main --fill --head "$branch" \
  && gh pr merge "$branch" --auto --squash --delete-branch \
  && echo "ok: PR opened + auto-merge queued" \
  || echo "fail: pr create or merge"
