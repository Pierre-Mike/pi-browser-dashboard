#!/usr/bin/env bash
# Coverage-floor gate: every `apps/daemon/src/features/<feature>/` directory
# that ships at least one source file (`*.ts`) MUST also ship at least one
# co-located test file (`*.test.ts`/`*.spec.ts`).
#
# Scoped to the daemon for now: that's where the AGENTS.md feature-slice
# pattern (`*.core.ts` / `*.repo.ts` / `*.routes.ts` + co-located tests)
# lives. The web app has different conventions (Playwright e2e); add it here
# once it adopts co-located unit tests.
#
# The pre-commit `check-tests-touched.sh` enforces *per-commit* TDD — every
# source-changing commit needs a staged test somewhere. This script is the
# *standing* invariant: a whole feature folder cannot exist without tests at
# all. It catches the case where a feature was authored under a green
# `SKIP_TDD=1` bypass and shipped untested.
#
# Bypass for a genuine exception (e.g. a generated stub folder):
#   SKIP_FEATURE_TEST_FLOOR=1 ./scripts/check-feature-tests.sh
set -euo pipefail

if [ "${SKIP_FEATURE_TEST_FLOOR:-0}" = "1" ]; then
  echo "↷ feature-test floor: SKIP_FEATURE_TEST_FLOOR=1, skipping check." >&2
  exit 0
fi

repo_root=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$repo_root"

missing=()

# Iterate every feature folder in every app.
while IFS= read -r -d '' feature_dir; do
  # Source files: any .ts excluding *.test.ts and *.spec.ts.
  src_count=$(find "$feature_dir" -maxdepth 1 -type f -name '*.ts' \
    ! -name '*.test.ts' ! -name '*.spec.ts' \
    | wc -l | tr -d ' ')

  if [ "$src_count" = "0" ]; then
    continue
  fi

  test_count=$(find "$feature_dir" -maxdepth 1 -type f \
    \( -name '*.test.ts' -o -name '*.spec.ts' \) \
    | wc -l | tr -d ' ')

  if [ "$test_count" = "0" ]; then
    missing+=("$feature_dir")
  fi
done < <(find apps/daemon/src/features -mindepth 1 -maxdepth 1 -type d -print0 2>/dev/null)

if [ "${#missing[@]}" -gt 0 ]; then
  {
    echo "✖ feature-test floor: the following feature folders ship source but no tests:"
    printf '  - %s\n' "${missing[@]}"
    echo
    echo "Every apps/daemon/src/features/<feature>/ folder must have at least one"
    echo "*.test.ts / *.spec.ts alongside its sources."
    echo
    echo "Genuine exception? Bypass with:"
    echo "  SKIP_FEATURE_TEST_FLOOR=1 ./scripts/check-feature-tests.sh"
  } >&2
  exit 1
fi

echo "✓ feature-test floor: every feature folder has tests." >&2
exit 0
