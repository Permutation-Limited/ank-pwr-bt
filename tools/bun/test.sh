#!/usr/bin/env bash
# Runs `bun test` for a Bazel sh_test. Args: $1 = bun binary (runfiles path),
# remaining args = test files (runfiles paths).
set -euo pipefail
RUNFILES="${RUNFILES_DIR:-$0.runfiles}"
BUN="$RUNFILES/$1"
shift
FILES=()
for f in "$@"; do FILES+=("$RUNFILES/$f"); done
export HOME="${TEST_TMPDIR:-$(mktemp -d)}"
exec "$BUN" test "${FILES[@]}"
