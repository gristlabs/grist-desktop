#!/usr/bin/env bash
#
# Run grist-core's deployment tests against the desktop app, the way core runs
# them against a docker image. See core/test/test_under_docker.sh, which this
# follows closely.
#
# These open real documents and evaluate real formulas, with whatever sandbox
# the app defaults to — unlike scripts/test-electron.js, which forces
# unsandboxed and so never exercises the sandbox we actually ship.
#
#   scripts/test-deployment.sh                # every deployment suite
#   scripts/test-deployment.sh ChoiceList     # named suites
#
# Point GRIST_DESKTOP_BIN at a packaged binary to test an artifact instead of
# the source build in core/_build.

set -o pipefail -o nounset -o errtrace -o errexit

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

# The app opens a window, and CI has no display. Re-exec under a private Xvfb,
# dropping the host session first so nothing can escape to a real desktop.
if [[ "$(uname)" == "Linux" && "${XVFB_RUNNING:-}" != "1" ]]; then
  export XVFB_RUNNING=1
  unset DISPLAY WAYLAND_DISPLAY XDG_SESSION_TYPE DBUS_SESSION_BUS_ADDRESS \
        XDG_RUNTIME_DIR XDG_CURRENT_DESKTOP XDG_DATA_DIRS XDG_CONFIG_DIRS GTK_USE_PORTAL
  exec xvfb-run --auto-servernum --server-args='-screen 0 1920x1080x24' "$0" "$@"
fi

PORT=${GRIST_PORT:-8686}
STATE=$(mktemp -d)
APP_PID=""

cleanup() {
  local code=$?
  if [[ -n "$APP_PID" ]]; then
    kill "$APP_PID" 2>/dev/null || true
    wait "$APP_PID" 2>/dev/null || true
  fi
  if [[ -f "$STATE/app.log" ]]; then
    # Say which sandbox ran: exercising the one we ship is the point of this.
    local flavors
    flavors=$(grep -ohE "flavor=[a-zA-Z]+" "$STATE/app.log" | sort -u | tr "\n" " " || true)
    if [[ -n "$flavors" ]]; then echo "[sandbox used: $flavors]"; fi
    if [[ $code -ne 0 ]]; then
      echo "--- last of the app's output ---"
      tail -30 "$STATE/app.log"
    fi
  fi
  rm -rf "$STATE"
  exit $code
}
trap cleanup EXIT
trap 'exit 1' INT TERM

mkdir -p "$STATE/inst" "$STATE/docs"

# GRIST_TEST_LOGIN makes core use its own login system in place of desktop's,
# which is what the borrowed suites know how to drive. It also seeds the
# support user's api key from TEST_SUPPORT_API_KEY.
export GRIST_PORT=$PORT
export GRIST_DESKTOP_AUTH=none
export GRIST_TEST_LOGIN=1
export GRIST_SESSION_COOKIE=grist_test_cookie
export TEST_SUPPORT_API_KEY=api_key_for_support
export GRIST_INST_DIR=$STATE/inst
export GRIST_DATA_DIR=$STATE/docs
export TYPEORM_DATABASE=$STATE/landing.db
export LANGUAGE=en_US

if [[ -n "${GRIST_DESKTOP_BIN:-}" ]]; then
  app=("$GRIST_DESKTOP_BIN")
else
  app=("$ROOT/node_modules/electron/dist/electron" --no-sandbox
       "$ROOT/core/_build/ext/app/electron/main.js")
fi
"${app[@]}" > "$STATE/app.log" 2>&1 &
APP_PID=$!

# Insist on "alive", not merely a response: the port opens before the server is
# ready, and answers /status with a 503 until then.
alive() { curl -fs "http://localhost:$PORT/status" 2>/dev/null | grep -q alive; }

echo "[waiting for server on :$PORT]"
for _ in $(seq 1 90); do
  if alive; then break; fi
  kill -0 "$APP_PID" 2>/dev/null || { echo "the app exited before serving"; exit 1; }
  sleep 1
done
alive || { echo "the server never reported itself alive"; exit 1; }
echo "[server alive]"

# core's deployment directory also holds Fork, HomeIntro and Smoke, which
# assume cloud Grist: anonymous fork-create, a templates org, sign-up flows.
# They fail here for that reason, not ours. Same call scripts/test-electron.js
# makes when it leaves Smoke out of DEFAULT_UPSTREAM_SUITES.
DEFAULT_SUITES=(ActionLog ChoiceList ColumnTransform CopyPasteLinked
                DetailView DuplicateDocument FilteringBugs LeftPanel
                MultiColumn1 MultiColumn3 Pages ReferenceColumns
                ReferenceList RowMenu ToggleColumns)

# Look in deployment/ first, then nbrowser/, as scripts/test-electron.js does.
# deployment/ is core's curated "safe against an external server" list, but it
# is not a boundary: plenty of nbrowser suites run fine this way too.
SUITES=()
for name in "${@:-${DEFAULT_SUITES[@]}}"; do
  for dir in deployment nbrowser; do
    if [[ -f "core/_build/test/$dir/$name.js" ]]; then
      SUITES+=("core/_build/test/$dir/$name.js"); continue 2
    fi
  done
  echo "no such suite: $name"; exit 1
done

MOCHA=$(node -e "console.log(require.resolve('mocha/bin/mocha.js',{paths:['$ROOT/core','$ROOT']}))")

TEST_ACCOUNT_PASSWORD=not-needed \
HOME_URL="http://localhost:$PORT" \
NODE_PATH="$ROOT/core/_build:$ROOT/core/_build/ext:$ROOT/core/_build/stubs" \
SELENIUM_BROWSER=chrome \
MOCHA_WEBDRIVER_IGNORE_CHROME_VERSION=1 \
  node "$MOCHA" --slow 6000 "${SUITES[@]}"
