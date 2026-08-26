// Mocha --require plugin for deployment mode: raise the floor under the
// upstream test helpers' server-wait timeouts.
//
// Upstream's helpers default to 5000ms for a round trip to the server, and
// 10000ms for a document to appear. Those numbers assume a sandbox that starts
// in milliseconds, which gvisor and unsandboxed do. Deployment mode
// deliberately runs the sandbox we actually ship, pyodide, whose first call
// against a fresh sandbox has been measured on CI at a 3.7s median on linux and
// windows and a 10.1s median on an intel mac, with a 34s tail there. Every
// suite that opens a document pays that once, and it is not a defect in the
// test or in the app -- just work that upstream's numbers do not budget for.
//
// The helpers take the timeout as an argument but read it from a default, with
// no env var and no setter, so there is nothing to configure. Patching the
// prototype from a --require plugin works because mocha loads these before any
// test file, and gristUtils binds the helpers off the prototype when it is
// first imported (`webdriverUtils.waitForServer.bind(webdriverUtils)`), which
// is later. Callers inside the class -- undo() reaching waitForServer() -- go
// through the patch too.
//
// grist-static does the same thing in bulk, shadowing whole upstream modules by
// NODE_PATH order (see its scripts/test_nbrowser.sh); this needs only default
// arguments changed, so it patches in place instead.

const path = require('path');

// The helpers below pull in mocha-webdriver, which installs the hooks that
// create the browser with a bare `before()` -- but only if that global exists,
// and inside a --require plugin it does not yet. It quietly skips them in that
// case and expects whoever loaded it early to pass on getMochaHooks() instead.
// Without this, every suite fails its "before all" hook with
// "WebDriver accessed before initialization".
exports.mochaHooks = require('mocha-webdriver').getMochaHooks();

const FLOOR = parseInt(process.env.GRIST_TEST_SERVER_TIMEOUT || '30000', 10);

// Resolved as an absolute path rather than through NODE_PATH, so we are certain
// to be patching the module the tests will get and not a second copy of it.
const {GristWebDriverUtils} = require(
  path.resolve(__dirname, '../../core/_build/test/nbrowser/gristWebDriverUtils'));

// A floor, not an override: a caller that already asked for longer than this
// knew something we do not, and keeps what it asked for.
function raiseFloor(method, index, upstreamDefault) {
  const orig = GristWebDriverUtils.prototype[method];
  GristWebDriverUtils.prototype[method] = function (...args) {
    while (args.length <= index) { args.push(undefined); }
    args[index] = Math.max(args[index] === undefined ? upstreamDefault : args[index], FLOOR);
    return orig.apply(this, args);
  };
}

if (FLOOR > 0) {
  raiseFloor('waitForServer', 0, 5000);
  raiseFloor('sendActions', 1, 5000);
  raiseFloor('waitForDocToLoad', 0, 10000);
  console.log(`[server waits floored at ${FLOOR}ms]`);
}
