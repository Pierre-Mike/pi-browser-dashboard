#!/usr/bin/env bash
#
# Idempotently apply .github/rulesets/main.json to this repository's branch
# rulesets. The committed file is the source of truth; this pushes it.
#
# Needs `gh auth login` (or GH_TOKEN) with ADMIN on the repo — the built-in
# GITHUB_TOKEN cannot manage rulesets, which is why this is a human-run script
# and not a workflow.
#
# Usage:  ./.github/scripts/apply-ruleset.sh [owner/repo]
# With owner/repo omitted, the current `gh repo` is used.
set -euo pipefail

ruleset_file="$(dirname "$0")/../rulesets/main.json"
repo="${1:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"
name="$(jq -r .name "$ruleset_file")"

echo "Applying ruleset '$name' to $repo ..."

# A ruleset with this name may already exist — update it (PUT) rather than
# creating a duplicate (POST), so re-running is a no-op. Look it up by name.
existing_id="$(gh api "repos/$repo/rulesets" --jq \
  ".[] | select(.name == \"$name\") | .id" 2>/dev/null || true)"

if [ -n "$existing_id" ]; then
  echo "Updating existing ruleset id=$existing_id"
  gh api --method PUT "repos/$repo/rulesets/$existing_id" --input "$ruleset_file"
else
  echo "Creating ruleset"
  gh api --method POST "repos/$repo/rulesets" --input "$ruleset_file"
fi

echo "Done. Verify with: gh api repos/$repo/rulesets/<id> --jq '.rules'"
