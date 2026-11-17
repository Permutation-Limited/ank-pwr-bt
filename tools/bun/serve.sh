#!/usr/bin/env bash
# Launcher for `bazel run //web:serve`. Args are runfiles-relative paths:
#   $1 = bun binary, $2 = serve.ts, $3 = any file in the site directory
set -euo pipefail
RUNFILES="${RUNFILES_DIR:-$0.runfiles}"
BUN="$RUNFILES/$1"
SERVER="$RUNFILES/$2"
SITE_DIR="$(dirname "$RUNFILES/$3")"
shift 3
exec "$BUN" "$SERVER" "$SITE_DIR" "$@"
