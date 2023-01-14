#!/bin/bash

set -e

echo "======================================================================="
echo "Make some tweaks for serving static resources"
if [ ! -e core/bower_components_ext ] ; then
  mkdir core/bower_components_ext
  ln -s ../../node_modules/bootstrap core/bower_components_ext/bootstrap
  ln -s ../../node_modules/bootstrap-datepicker core/bower_components_ext/bootstrap-datepicker
  ln -s ../../node_modules/jquery core/bower_components_ext/jquery
  ln -s ../../node_modules/components-jqueryui core/bower_components_ext/jqueryui
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
  if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    if [[ ! -e core/cpython.tar.gz ]]; then
      curl -L https://github.com/indygreg/python-build-standalone/releases/download/20221220/cpython-3.9.16+20221220-x86_64-unknown-linux-gnu-install_only.tar.gz -o core/cpython.tar.gz
    fi
    cd core && tar xfz cpython.tar.gz && cd ..
  else
    echo "Do not know what to do about Python on $OSTYPE, will use end-user's system python3"
  fi
fi
