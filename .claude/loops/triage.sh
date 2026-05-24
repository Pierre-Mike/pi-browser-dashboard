#!/usr/bin/env bash
set -euo pipefail
exec >>".claude/auto-pr.log" 2>&1
echo "[$(date -u +%FT%TZ)] event=triage"

gh pr list --state open --author "@me" \
  --json number,headRefName,isDraft,statusCheckRollup \
| jq -c '.[]' | while read -r pr; do
    n=$(echo "$pr" | jq -r .number)
    is_draft=$(echo "$pr" | jq -r .isDraft)
    failed=$(echo "$pr" | jq -r \
      '[.statusCheckRollup[] | select(.conclusion=="FAILURE")] | length')
    pending=$(echo "$pr" | jq -r \
      '[.statusCheckRollup[] | select(.status!="COMPLETED" and (.conclusion // "")=="")] | length')
    total=$(echo "$pr" | jq -r '.statusCheckRollup | length')
    if [ "$failed" -gt 0 ]; then
      gh run rerun --failed -R Pierre-Mike/pi-browser-dashboard \
        || echo "skip: rerun failed for #$n"
      echo "reran: #$n ($failed failing checks)"
      continue
    fi
    if [ "$is_draft" = "true" ] && [ "$total" -gt 0 ] \
       && [ "$failed" = 0 ] && [ "$pending" = 0 ]; then
      gh pr ready "$n" \
        && gh pr merge "$n" --auto --squash --delete-branch \
        && echo "promoted: #$n (draft→ready, auto-merge queued)" \
        || echo "fail: promote #$n"
    fi
  done
