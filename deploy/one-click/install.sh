#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TARGET="$SCRIPT_DIR/installer/install.sh"
[[ -f "$TARGET" ]] || TARGET="$SCRIPT_DIR/../installer/install.sh"
exec "$TARGET" standalone "$@"
