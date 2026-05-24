#!/usr/bin/env bash
set -euo pipefail
exec >>".claude/auto-pr.log" 2>&1
echo "[$(date -u +%FT%TZ)] event=reap"

cd /Users/pierre-mikel/Github/pi-browser-dashboard

for wt_path in .claude/worktrees/*/; do
  [ -d "$wt_path" ] || continue
  wt_path="${wt_path%/}"
  branch=$(git -C "$wt_path" rev-parse --abbrev-ref HEAD 2>/dev/null) || continue
  [ -n "$branch" ] && [ "$branch" != "HEAD" ] || { echo "skip-detached: $wt_path"; continue; }

  pr_state=$(gh pr list --head "$branch" --state all --limit 1 \
    --json state --jq '.[0].state' 2>/dev/null || echo "")

  case "$pr_state" in
    MERGED|CLOSED)
      if git worktree remove "$wt_path" 2>/dev/null; then
        git branch -D "$branch" 2>/dev/null || true
        echo "reaped: $wt_path (PR $pr_state)"
      else
        echo "skip-dirty: $wt_path (PR $pr_state)"
      fi
      ;;
    "")
      echo "skip-no-pr: $wt_path (branch=$branch)"
      ;;
    *)
      echo "skip-open: $wt_path (PR $pr_state, branch=$branch)"
      ;;
  esac
done

git worktree prune
