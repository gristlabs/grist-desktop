#!/bin/bash

set -e

case $TARGET_ARCH in
  "x86")
    ARCHFLAG="--ia32"
    ;;
  "x64")
    ARCHFLAG="--x64"
    ;;
  "arm64")
    ARCHFLAG="--arm64"
    ;;
  *)
    echo "Target architecture $TARGET_ARCH not supported"
    exit 1
    ;;
esac

electron-builder build $ARCHFLAG --publish always
