/**
 * Mocha --require plugin for deployment mode. It raises the floor under the
 * upstream test helpers' server waits, which allow 5s for a round trip and 10s for
 * a document to appear -- fine for a sandbox that starts in milliseconds, but this
 * mode runs the one we ship, pyodide, whose first call takes seconds.
 *
 * The helpers take their timeout from a default argument, with no env var and no
 * setter, so the prototype is patched instead. That has to happen in a --require
 * plugin: gristUtils binds the helpers off the prototype when it is first imported,
 * and mocha loads these before any test file.
 */

const path = require('path');

const TEST_FLOOR = parseInt(process.env.GRIST_TEST_TIMEOUT || '90000', 10);
const SERVER_FLOOR = parseInt(process.env.GRIST_TEST_SERVER_TIMEOUT || '30000', 10);

/**
 * Requiring the helpers pulls in mocha-webdriver, which installs its
 * browser-creating hooks only if a global `before` exists. Inside a --require
 * plugin it does not, so mocha-webdriver skips them and expects us to pass on
 * getMochaHooks() instead. Without that, every suite fails its "before all" hook.
 */
const hooks = require('mocha-webdriver').getMochaHooks();
exports.mochaHooks = hooks;

/**
 * Raising a helper's wait achieves nothing if the runnable around it times out
 * first, and several upstream suites declare this.timeout(20000), which beats
 * mocha's --timeout.
 *
 * Hooks have to be raised by name, and from a root beforeAll. Mocha copies a
 * suite's timeout into each hook as the hook is built, so raising the suite alone
 * leaves its `before` on the old number -- and `before` is where these suites open
 * their first document, the slowest thing they do.
 */
function raise(runnable) {
  if (runnable.timeout() > 0 && runnable.timeout() < TEST_FLOOR) {
    runnable.timeout(TEST_FLOOR);
  }
}

function raiseSuite(suite) {
  raise(suite);
  for (const kind of ['_beforeAll', '_beforeEach', '_afterEach', '_afterAll']) {
    (suite[kind] || []).forEach(raise);
  }
  suite.tests.forEach(raise);
  suite.suites.forEach(raiseSuite);
}

const startDriver = hooks.beforeAll;

/**
 * mocha-webdriver's own hook sets this.timeout(20000) as its first statement, which beats
 * anything raised before it runs. Starting the browser occasionally takes longer than that on a
 * busy runner, and the whole run then fails having run no tests. It sets the timeout
 * synchronously, so raising it again straight after the call applies to the wait itself.
 */
hooks.beforeAll = [
  function () { raiseSuite(this.runnable().parent); },
  function () {
    const started = startDriver.call(this);
    this.timeout(TEST_FLOOR);
    return started;
  },
];

// Resolved absolutely rather than through NODE_PATH, so we patch the module the
// tests will get and not a second copy of it.
const {GristWebDriverUtils} = require(
  path.resolve(__dirname, '../../core/_build/test/nbrowser/gristWebDriverUtils'));

/**
 * A floor, not an override: a caller that asked for longer keeps what it asked for.
 */
function raiseFloor(method, index, upstreamDefault) {
  const orig = GristWebDriverUtils.prototype[method];
  GristWebDriverUtils.prototype[method] = function (...args) {
    args[index] = Math.max(args[index] ?? upstreamDefault, SERVER_FLOOR);
    return orig.apply(this, args);
  };
}

if (SERVER_FLOOR > 0) {
  raiseFloor('waitForServer', 0, 5000);
  raiseFloor('sendActions', 1, 5000);
  raiseFloor('waitForDocToLoad', 0, 10000);
  console.log(`[server waits floored at ${SERVER_FLOOR}ms]`);
}
