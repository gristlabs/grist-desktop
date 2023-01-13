/**
 *
 * The goal of this module is to shorten the dev cycle when targeting electron specifically.
 *
 * It allows to run electron without running `./build electron-dev` each time. Although, if electron
 * has never been built in your system, you might still be required to run `./builds electron-dev`
 * for building some native node module.
 *
 * If you're modifying files that are bundled, you migth want to have a `npm start` running.
 *
 * Usage:
 * `bin/electron app/electron/runPrebuild.js`
 */
 // todo: could be nice to have the app restarts automatically when files are modified.


const path = require('path');

const build = path.resolve(__dirname + "/../.." + "/_build");
const paths = [build, build + '/core', build + '/ext', build + '/stubs'];
module.paths.push(...paths);

const Module = require('module');
Module.globalPaths.push(...paths);

// for electron >= 17
const nodeModulePaths = Module._nodeModulePaths;
Module._nodeModulePaths = (from) => nodeModulePaths(from).concat(paths);

// main.js does not expects the module's path in argv
process.argv.splice(1, 1);

// For the built version appRoot is defined relatively, but the files structure is different and the
// path does not work for prebuild, hence we need to override it.
process.env.GRIST_APP_ROOT = path.resolve(__dirname, "../../");

require('app/electron/main.js');
