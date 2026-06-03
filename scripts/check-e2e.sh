#!/usr/bin/env bash
# Pre-push Playwright e2e gate (invoked by lefthook). A red suite aborts the
# push, so a broken branch never reaches the remote and no PR opens on it.
#
# Bypass for genuine exceptions (docs-only push, dep bump, broken local env):
#   SKIP_E2E=1 git push …
#   git push --no-verify …
set -euo pipefail

if [ "${SKIP_E2E:-0}" = "1" ]; then
  echo "↷ pre-push: SKIP_E2E=1, skipping Playwright e2e gate." >&2
  exit 0
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "✖ pre-push: bun not found on PATH — install bun or bypass with SKIP_E2E=1." >&2
  exit 1
fi

echo "▶ pre-push: running Playwright e2e suite (SKIP_E2E=1 to bypass)…" >&2
if ! bun run test:e2e; then
  cat <<'EOF' >&2

✖ pre-push: Playwright e2e suite failed. Push aborted.

Inspect failures:
  apps/e2e/test-results/

Re-run locally:
  bun run test:e2e
  bun run test:e2e:ui   # interactive

Bypass for genuine exceptions (docs/dep-bump/broken-env):
  SKIP_E2E=1 git push …
  git push --no-verify …
EOF
  exit 1
fi

echo "✔ pre-push: e2e green." >&2
