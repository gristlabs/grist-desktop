#!/usr/bin/env bash
# Run upstream Smoke against the desktop Electron binary, keeping the temp
# dir / chromedriver log around for inspection.
#
# Run headed:    HEADLESS=0 ./test.sh
# Other tests:   ./test.sh Pages
# Mocha args:    ./test.sh Smoke --grep create

set -euo pipefail
cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"

NAME="${1:-ActionLog}"
shift || true

VERBOSE=1 DEBUG=1 XKEEP_TMPDIR=1 ./scripts/test-electron.js --upstream "$NAME" "$@"
