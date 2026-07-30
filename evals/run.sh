#!/usr/bin/env bash
# Compatibility shim — the eval runner is evals/run.ts (task × model × repeat
# grid, graded scoring, functional asserts, cost telemetry). Every flag is
# forwarded:
#
#   ./evals/run.sh --suite full --models opus,sonnet,haiku --repeats 3
#   ./evals/run.sh --baseline --suite full     # no agent, no tokens, no cost
#
# See evals/README.md.
set -euo pipefail
exec bun run "$(cd "$(dirname "$0")" && pwd)/run.ts" "$@"
