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
existing="$(gh pr list --head "$branch" --state open --json number --jq length 2>/dev/null || echo 0)"
[ "$existing" = 0 ] || { echo "skip: PR exists"; exit 0; }
git push -u origin "$branch" || { sleep 2; git push -u origin "$branch"; } || { echo "fail: push"; exit 0; }
gh pr create --base main --fill --head "$branch" \
  && gh pr merge "$branch" --auto --squash --delete-branch \
  && echo "ok: PR opened + auto-merge queued" \
  || echo "fail: pr create or merge"
