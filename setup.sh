#!/bin/bash

set -ex

if [ ! -e core/bower_components_ext ] ; then
  mkdir core/bower_components_ext
  ln -s ../../node_modules/bootstrap core/bower_components_ext/bootstrap
  ln -s ../../node_modules/bootstrap-datepicker core/bower_components_ext/bootstrap-datepicker
  ln -s ../../node_modules/jquery core/bower_components_ext/jquery
  ln -s ../../node_modules/components-jqueryui core/bower_components_ext/jqueryui
fi

if [ ! -e core/ext ]; then
  ln -s ../ext core/ext
fi
