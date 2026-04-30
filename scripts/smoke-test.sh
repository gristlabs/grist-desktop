#!/bin/bash

set -ex

# On Linux without a display server (e.g. CI), Chromium aborts at startup
# unless ozone is told to run headless. The switch must be on argv before
# Electron initializes — `app.commandLine.appendSwitch` from JS is too late.
ozone=""
if [[ "$(uname)" == "Linux" && -z "$DISPLAY" && -z "$WAYLAND_DISPLAY" ]]; then
  ozone="--ozone-platform=headless"
fi

grist="electron $ozone core/_build/ext/app/electron/main.js"

$grist --version
$grist --cli sqlite query core/test/fixtures/docs/World.grist "select * from City limit 1"
