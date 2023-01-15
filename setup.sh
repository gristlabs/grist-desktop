#!/bin/bash

set -ex

os="$1"
if [[ "$os" = "" ]]; then
  os="$OSTYPE"
fi

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
  if [[ "$os" = "linux-gnu"* ]]; then
    if [[ ! -e core/cpython.tar.gz ]]; then
      curl -L https://github.com/indygreg/python-build-standalone/releases/download/20221220/cpython-3.9.16+20221220-x86_64-unknown-linux-gnu-install_only.tar.gz -o core/cpython.tar.gz
    fi
    cd core && tar xfz cpython.tar.gz && cd ..
  elif [[ "$os" = "msys"* ]]; then
    if [[ ! -e core/cpython.tar.gz ]]; then
      if [[ "$RUN_ARCH" = "x86" ]]; then
        curl -L https://github.com/indygreg/python-build-standalone/releases/download/20221220/cpython-3.9.16+20221220-i686-pc-windows-msvc-shared-install_only.tar.gz -o core/cpython.tar.gz
      else
        curl -L https://github.com/indygreg/python-build-standalone/releases/download/20221220/cpython-3.9.16+20221220-x86_64-pc-windows-msvc-shared-install_only.tar.gz -o core/cpython.tar.gz
      fi
    fi
    if [[ ! -e core/api.zip ]]; then
      # version of a needed dll reconstructed for blender based on wine
      curl -L https://github.com/nalexandru/api-ms-win-core-path-HACK/releases/download/0.3.1/api-ms-win-core-path-blender-0.3.1.zip -o core/api.zip
    fi
    cd core && tar xfz cpython.tar.gz && cd ..
    if [[ "$RUN_ARCH" = "x86" ]]; then
      cd core && unzip api.zip && cp api-ms-win-core-path-blender/x86/*.dll python/ && cd ..
    else
      cd core && unzip api.zip && cp api-ms-win-core-path-blender/x64/*.dll python/ && cd ..
    fi
  elif [[ "$os" = "darwin"* ]]; then
    if [[ ! -e core/cpython.tar.gz ]]; then
      curl -L https://github.com/indygreg/python-build-standalone/releases/download/20221220/cpython-3.9.16+20221220-x86_64-apple-darwin-install_only.tar.gz -o core/cpython.tar.gz
    fi
    cd core && tar xfz cpython.tar.gz && cd ..
  else
    echo "Do not know what to do about Python on $OSTYPE, will use end-user's system python3"
  fi
fi
