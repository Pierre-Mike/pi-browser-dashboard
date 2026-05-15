#!/usr/bin/env bash
# One-time setup: log into Claude against a persistent e2e config dir.
# After this completes, set PID_E2E_AUTH_DIR=$DIR and re-run `bun test:e2e`
# to exercise auth-only paths (real key delivery, transcript content, peek
# summary, etc.).
#
# The dir is reused across runs; each run scrubs ephemeral state (jobs/,
# daemon/, projects/, workspace/) but preserves credentials.

set -euo pipefail

DIR="${1:-$HOME/.claude-e2e}"

echo "e2e auth dir: $DIR"
mkdir -p "$DIR"

if [ -d "$DIR/sessions" ] && [ -f "$DIR/.claude.json" ]; then
  echo "auth artifacts already present — skipping login. Delete $DIR and re-run to force a fresh login."
else
  echo "running 'claude auth login' against $DIR (interactive)…"
  CLAUDE_CONFIG_DIR="$DIR" claude auth login
fi

echo ""
echo "done. export PID_E2E_AUTH_DIR=\"$DIR\" before running bun test:e2e."
