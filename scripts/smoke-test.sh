#!/bin/bash

set -ex

grist="electron core/_build/ext/app/electron/main.js"

$grist --version
$grist --cli sqlite query core/test/fixtures/docs/World.grist "select * from City limit 1"
