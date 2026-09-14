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

const {raiseSuite, TEST_FLOOR} = require('./raiseTimeouts');

const SERVER_FLOOR = parseInt(process.env.GRIST_TEST_SERVER_TIMEOUT || '30000', 10);

/**
 * Requiring the helpers pulls in mocha-webdriver, which installs its
 * browser-creating hooks only if a global `before` exists. Inside a --require
 * plugin it does not, so mocha-webdriver skips them and expects us to pass on
 * getMochaHooks() instead. Without that, every suite fails its "before all" hook.
 */
const hooks = require('mocha-webdriver').getMochaHooks();
exports.mochaHooks = hooks;

const startDriver = hooks.beforeAll;

/**
 * mocha-webdriver's own hook sets this.timeout(20000) as its first statement, which overrides
 * any value set before it runs. Starting the browser occasionally takes longer than that on a
 * busy runner, and the run then fails before any test runs. It sets the timeout synchronously,
 * so raising it again straight after the call applies to the wait itself.
 */
hooks.beforeAll = [
  function () { raiseSuite(this.runnable().parent); },
  async function () {
    const started = startDriver.call(this);
    this.timeout(TEST_FLOOR);
    await started;
    if (this.timeout() !== TEST_FLOOR) {
      throw new Error(`driver start ran at ${this.timeout()}ms, not the ${TEST_FLOOR}ms set ` +
        `here: mocha-webdriver no longer sets its timeout in its hook's first statement`);
    }
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
