#!/usr/bin/env bash
# TDD gate: any staged change under apps/*/src/** must ship with at least one
# staged test file (*.spec.ts / *.test.ts / *.spec.tsx / *.test.tsx) somewhere
# in the commit. Bypass for genuine exceptions:
#   SKIP_TDD=1 git commit ...
#   git commit --no-verify ...
set -euo pipefail

if [ "${SKIP_TDD:-0}" = "1" ]; then
  exit 0
fi

staged=$(git diff --cached --name-only --diff-filter=ACMR)
[ -z "$staged" ] && exit 0

src_changes=$(printf '%s\n' "$staged" \
  | grep -E '^apps/[^/]+/src/' \
  | grep -Ev '\.(spec|test)\.(ts|tsx)$' \
  || true)

if [ -z "$src_changes" ]; then
  exit 0
fi

test_changes=$(printf '%s\n' "$staged" \
  | grep -E '\.(spec|test)\.(ts|tsx)$' \
  || true)

if [ -n "$test_changes" ]; then
  exit 0
fi

cat <<EOF >&2
✖ TDD gate: source changed without any staged test file.

Changed source files:
$(printf '  - %s\n' $src_changes)

Add a *.spec.ts / *.test.ts (or *.tsx) alongside this change.
Genuine exception? Bypass with:
  SKIP_TDD=1 git commit ...
  # or
  git commit --no-verify ...
EOF
exit 1
