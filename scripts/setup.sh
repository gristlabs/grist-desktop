#!/bin/bash

set -e

# Pick a version from https://github.com/indygreg/python-build-standalone/releases
# Assets look like cpython-${PYTHON_VERSION}+${PYTHON_BUILD_DATE}-...
# Must be >=3.10 to support PREVIOUS.
PYTHON_VERSION=3.11.9
PYTHON_BUILD_DATE=20240726

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
  cd core
  tar xfz cpython.tar.gz
  cd ..
}

function fetch_msapi {
  if [[ ! -e core/api.zip ]]; then
    # version of a needed dll reconstructed for blender based on wine
    curl -L https://github.com/nalexandru/api-ms-win-core-path-HACK/releases/download/0.3.1/api-ms-win-core-path-blender-0.3.1.zip -o core/api.zip
  fi
}

function unpack_msapi {
  if [[ "$arch" = "x86" ]]; then
    cd core
    unzip api.zip
    cp api-ms-win-core-path-blender/x86/*.dll python/
    cd ..
  elif [[ "$arch" = "x64" ]]; then
    cd core
    unzip api.zip
    cp api-ms-win-core-path-blender/x64/*.dll python/
    cd ..
  else
    not_implemented
  fi
}

function python_for_linux {
  if [[ "$arch" = "x64" ]]; then
    fetch_python ${PYTHON_BUILD_DATE}/cpython-${PYTHON_VERSION}+${PYTHON_BUILD_DATE}-x86_64_v3-unknown-linux-gnu-install_only.tar.gz
  elif [[ "$arch" = "arm64" ]]; then
    fetch_python ${PYTHON_BUILD_DATE}/cpython-${PYTHON_VERSION}+${PYTHON_BUILD_DATE}-aarch64-unknown-linux-gnu-install_only.tar.gz
  else
    not_implemented
  fi
  unpack_python
}

function python_for_windows {
  if [[ "$arch" = "x64" ]]; then
    fetch_python ${PYTHON_BUILD_DATE}/cpython-${PYTHON_VERSION}+${PYTHON_BUILD_DATE}-x86_64-pc-windows-msvc-shared-install_only.tar.gz
  elif [[ "$arch" = "x86" ]]; then
    fetch_python ${PYTHON_BUILD_DATE}/cpython-${PYTHON_VERSION}+${PYTHON_BUILD_DATE}-i686-pc-windows-msvc-shared-install_only.tar.gz
  else
    not_implemented
  fi
  fetch_msapi
  unpack_python
  unpack_msapi
}

function python_for_mac {
  if [[ "$arch" = "x64" ]]; then
    fetch_python ${PYTHON_BUILD_DATE}/cpython-${PYTHON_VERSION}+${PYTHON_BUILD_DATE}-x86_64-apple-darwin-install_only.tar.gz
  elif [[ "$arch" = "arm64" ]]; then
    fetch_python ${PYTHON_BUILD_DATE}/cpython-${PYTHON_VERSION}+${PYTHON_BUILD_DATE}-aarch64-apple-darwin-install_only.tar.gz
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
  ln -s ../../node_modules/bootstrap-datepicker core/static_ext/bootstrap-datepicker
  ln -s ../../node_modules/jquery core/static_ext/jquery
  ln -s ../../node_modules/components-jqueryui core/static_ext/jqueryui
  ln -s ../../node_modules/highlight.js/styles/default.css core/static_ext/hljs.default.css
fi

echo ""
echo "======================================================================="
echo "Configure Grist to include external Electron code during build"

# We basically want core/ext to be a link to ext, for a lightly
# customized build of Grist. But there are two relative symlinks in ext to
# version information that now confuse the electron builder. So we make
# core/ext a real directory and place symlinks within it. Electron builder
# appears to cope okay with this. Links are absolute and unnested to make
# Windows happy.
rm -rf core/ext
mkdir core/ext
for f in $(cd ext; ls); do
  ln -s $(readlink -f $PWD/ext/$f) core/ext/$f
done

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

echo ""
echo "======================================================================="
echo "Tweak typescript project layout"

# Make some links to make a valid typescript project and make editors happier to autocomplete
for d in buildtools app stubs; do
  if [[ ! -e $d ]]; then
    ln -s core/$d $d
  fi
done
if [[ ! -e tsconfig.json ]]; then
  ln -s core/tsconfig-ext.json tsconfig.json
fi

echo ""
echo "======================================================================="
echo "Get Pyodide ready"

cd core/sandbox/pyodide
# work around an awkward bug with sh + make + windows + runners
#   https://github.com/actions/runner-images/issues/7253
bash ./setup.sh
make fetch_packages
# need at least one file for the directory to get unpacked by pyodide
touch _build/cache/EMPTY
