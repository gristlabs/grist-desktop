/**
 * A floor under the timeouts the borrowed suites declare, for both test modes.
 *
 * Those suites budget for the machines core runs them on, which are faster than ours: the
 * app starts an Electron window, and in deployment mode a pyodide sandbox whose first call
 * takes seconds. A suite that declares this.timeout(20000) beats mocha's --timeout, so the
 * number it declares has to be raised directly.
 *
 * Hooks have to be raised by name, and only once the suites are built, which is why this
 * runs from a root beforeAll. Mocha copies a suite's timeout into each hook as the hook is
 * built, so raising the suite alone leaves its `before` on the old number -- and `before` is
 * where these suites open their first document, the slowest thing they do.
 */

const asked = parseInt(process.env.GRIST_TEST_TIMEOUT, 10);
const TEST_FLOOR = asked > 0 ? asked : 120000;

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

exports.TEST_FLOOR = TEST_FLOOR;
exports.raiseSuite = raiseSuite;
