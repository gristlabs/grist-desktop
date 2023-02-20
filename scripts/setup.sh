#!/bin/bash

set -e

# Call with os and arch.
# Or set $OSTYPE and $RUN_ARCH and call with nothing.
# OSTYPEs are aliased as follows:
#    linux: linux-gnu*
#    windows: msys*
#    mac: darwin*
# Architecture values accepted are x64, x86, and arm64.
# Some brutal aliasing:
#    arm64: arm64, aarch64
#    x64: x64, amd64, x86_64
# Implemented permutations:
#    linux x64,arm64
#    windows x64,x86
#    mac x64

os="$1"
if [[ "$os" = "" ]]; then
  os="$OSTYPE"
fi

arch="$2"
if [[ "$arch" = "" ]]; then
  arch="$RUN_ARCH"
fi
if [[ "$arch" = "" ]]; then
  arch="x64"
fi
if [[ "$arch" = "amd64" ]]; then
  arch="x64"
fi
if [[ "$arch" = "x86_64" ]]; then
  arch="x64"
fi
if [[ "$arch" = "aarch64" ]]; then
  arch="arm64"
fi

if [[ "$os" = "linux-gnu"* ]]; then
  os="linux"
fi
if [[ "$os" = "linux-musl"* ]]; then
  os="linux"
fi
if [[ "$os" = "msys"* ]]; then
  os="windows"
fi
if [[ "$os" = "darwin"* ]]; then
  os="mac"
fi

function not_implemented {
  echo "Combination of OS [$os] and architecture [$arch] not implemented yet"
  exit 1
}

function fetch_python {
  download="$1"
  if [[ ! -e core/cpython.tar.gz ]]; then
    curl -L https://github.com/indygreg/python-build-standalone/releases/download/$download -o core/cpython.tar.gz
  fi
}

function unpack_python {
  cd core && tar xfz cpython.tar.gz && cd ..
}

function fetch_msapi {
  if [[ ! -e core/api.zip ]]; then
    # version of a needed dll reconstructed for blender based on wine
    curl -L https://github.com/nalexandru/api-ms-win-core-path-HACK/releases/download/0.3.1/api-ms-win-core-path-blender-0.3.1.zip -o core/api.zip
  fi
}

function unpack_msapi {
  if [[ "$arch" = "x86" ]]; then
    cd core && unzip api.zip && cp api-ms-win-core-path-blender/x86/*.dll python/ && cd ..
  elif [[ "$arch" = "x64" ]]; then
    cd core && unzip api.zip && cp api-ms-win-core-path-blender/x64/*.dll python/ && cd ..
  else
    not_implemented
  fi
}

function python_for_linux {
  if [[ "$arch" = "x64" ]]; then
    fetch_python 20221220/cpython-3.9.16+20221220-x86_64-unknown-linux-gnu-install_only.tar.gz
  elif [[ "$arch" = "arm64" ]]; then
    fetch_python 20221220/cpython-3.9.16+20221220-aarch64-unknown-linux-gnu-install_only.tar.gz
  else
    not_implemented
  fi
  unpack_python
}

function python_for_windows {
  if [[ "$arch" = "x64" ]]; then
    fetch_python 20221220/cpython-3.9.16+20221220-x86_64-pc-windows-msvc-shared-install_only.tar.gz
  elif [[ "$arch" = "x86" ]]; then
    fetch_python 20221220/cpython-3.9.16+20221220-i686-pc-windows-msvc-shared-install_only.tar.gz
  else
    not_implemented
  fi
  fetch_msapi
  unpack_python
  unpack_msapi
}

function python_for_mac {
  if [[ "$arch" = "x64" ]]; then
    fetch_python 20221220/cpython-3.9.16+20221220-x86_64-apple-darwin-install_only.tar.gz
  elif [[ "$arch" = "arm64" ]]; then
    fetch_python 20221220/cpython-3.9.16+20221220-aarch64-apple-darwin-install_only.tar.gz
  else
    not_implemented
  fi
  unpack_python
}

set -x

echo "======================================================================="
echo "Fix paths for static resources that are node_module symlinks in core"
if [ ! -e core/static_ext ] ; then
  mkdir core/static_ext
  ln -s ../../node_modules/bootstrap core/static_ext/bootstrap
  ln -s ../../node_modules/bootstrap-datepicker core/static_ext/bootstrap-datepicker
  ln -s ../../node_modules/jquery core/static_ext/jquery
  ln -s ../../node_modules/components-jqueryui core/static_ext/jqueryui
  ln -s ../../node_modules/highlight.js/styles/default.css core/static_ext/hljs.default.css
fi

echo ""
echo "======================================================================="
echo "Configure Grist to include external Electron code during build"

if [ ! -e core/ext ]; then
  ln -s ../ext core/ext
fi

echo ""
echo "======================================================================="
echo "Make a self-contained version of Python available"
if [[ ! -e core/python ]]; then
  python_for_$os || {
    echo "Did not install self-contained Python for $os:$arch, will use end-user's system python3"
  }
  if [[ -e core/python/bin/python3 ]]; then
    core/python/bin/python3 --version
  fi
fi

# Make some links to make a valid typescript project and make editors happier to autocomplete
for d in buildtools app stubs; do
  if [[ ! -e $d ]]; then
    ln -s core/$d $d
  fi
done
if [[ ! -e tsconfig.json ]]; then
  ln -s core/tsconfig-ext.json tsconfig.json
fi
