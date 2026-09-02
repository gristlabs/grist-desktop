#!/usr/bin/env node
/*
 * Cross-platform runner for the WebDriver-driven Electron test harness.
 * Replaces the Linux-only test_electron.sh.
 *
 * Usage:
 *   scripts/test-electron.js                    # local smoke
 *   scripts/test-electron.js --upstream         # core deployment Smoke
 *   scripts/test-electron.js --upstream Foo Bar # named upstream tests
 *   scripts/test-electron.js --deployment       # upstream tests, app as server
 *
 * Deployment mode runs the app as an ordinary Grist server and drives it with a
 * normal browser, as core runs its deployment tests against a docker image (see
 * core/test/test_under_docker.sh). It needs none of test/electron/setup.js, and
 * uses whatever sandbox the app defaults to rather than forcing unsandboxed.
 * GRIST_DESKTOP_BIN points it at a packaged binary.
 *
 * On Linux without a real display, wraps in xvfb-run and isolates D-Bus so
 * native dialogs can't escape to the host. macOS and Windows runners have a
 * display and run directly.
 */

const {spawn, spawnSync} = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const IS_LINUX = process.platform === 'linux';
const HEADLESS = process.env.HEADLESS !== '0';

// Upstream nbrowser suites known to pass cleanly against the desktop.
// Smoke is excluded: it depends on cloud Grist's anonymous-fork-create UX,
// which doesn't apply to desktop's file-backed docs.
const DEFAULT_UPSTREAM_SUITES = [
  'ActionLog', 'ChoiceList', 'ColumnTransform', 'CopyPasteLinked',
  'DetailView', 'DuplicateDocument', 'FilteringBugs', 'LeftPanel',
  'MultiColumn1', 'MultiColumn3', 'Pages', 'RowMenu', 'ToggleColumns',
];

// The same suites also pass in deployment mode, along with two the window modes
// cannot run.
//
// ReferenceList is a good illustration of what this mode is for. It opens with
// testUtils.withoutSandboxing(), which sets GRIST_SANDBOX_FLAVOR in the mocha
// process; here the app is a separate process that started before mocha did, so
// that has no effect and the suite runs against the very sandbox it asked not to
// use. Its three gu.sendActions() calls then sat right on the 5s of script time
// the helper allows, and were seen both to pass and to time out on the same
// machine -- which is what deployment-timeouts.js exists to fix.
const DEFAULT_DEPLOYMENT_SUITES = [
  ...DEFAULT_UPSTREAM_SUITES, 'ReferenceColumns', 'ReferenceList',
];

function parseArgs(argv) {
  let mode = 'local';
  const rest = [...argv];
  if (rest[0] === '--upstream') { mode = 'upstream'; rest.shift(); }
  else if (rest[0] === '--deployment') { mode = 'deployment'; rest.shift(); }
  return {mode, names: rest};
}

function resolveTestFiles(mode, names) {
  if (mode === 'local') {
    if (names[0] === 'Probe') { return [path.join(ROOT, 'test/electron/Probe.test.js')]; }
    return [path.join(ROOT, 'test/electron/Smoke.test.js')];
  }
  const defaults = mode === 'deployment' ? DEFAULT_DEPLOYMENT_SUITES : DEFAULT_UPSTREAM_SUITES;
  const targets = names.length > 0 ? names : defaults;
  return targets.map(name => {
    for (const dir of ['deployment', 'nbrowser']) {
      const p = path.join(ROOT, 'core/_build/test', dir, `${name}.js`);
      if (fs.existsSync(p)) { return p; }
    }
    throw new Error(`test not found: ${name} (not in deployment/ or nbrowser/)`);
  });
}

function checkPrereqs() {
  // Not the .bin shim: it is a .cmd on Windows, and spawning that throws EINVAL.
  const mochaBin = require.resolve('mocha/bin/mocha.js', {paths: [path.join(ROOT, 'core'), ROOT]});
  const appEntry = path.join(ROOT, 'core/_build/ext/app/electron/main.js');
  if (!fs.existsSync(appEntry)) {
    throw new Error('build output missing; run yarn build first');
  }
  return {mochaBin, appEntry};
}

function buildEnv(mode) {
  const sep = path.delimiter;
  const nodePath = [
    path.join(ROOT, 'core/_build/ext'),
    path.join(ROOT, 'core/_build/stubs'),
    path.join(ROOT, 'core/_build'),
  ].join(sep);
  return {
    ...process.env,
    NODE_PATH: nodePath,
    SELENIUM_BROWSER: 'chrome',
    MOCHA_WEBDRIVER_IGNORE_CHROME_VERSION: '1',
    GRIST_LOG_LEVEL: process.env.GRIST_LOG_LEVEL || 'warn',
    // Tells setup.js to do the extra setup the borrowed Grist suites need.
    ...(mode === 'upstream' ? {GRIST_DESKTOP_TEST_UPSTREAM: '1'} : {}),
  };
}

// On Linux + headless, re-exec ourselves under xvfb-run so the BrowserWindow
// has a virtual display, and unset host session env so native dialogs (file
// pickers, etc.) can't escape via xdg-desktop-portal.
function maybeReexecUnderXvfb(argv) {
  if (!IS_LINUX || !HEADLESS || process.env.XVFB_RUNNING === '1') { return false; }
  const xvfb = spawnSync('command', ['-v', 'xvfb-run'], {shell: true});
  if (xvfb.status !== 0) {
    console.warn(`warning: xvfb-run not found; running against $DISPLAY=${process.env.DISPLAY || ''}`);
    return false;
  }
  const env = {...process.env, XVFB_RUNNING: '1'};
  for (const v of ['WAYLAND_DISPLAY', 'XDG_SESSION_TYPE', 'DBUS_SESSION_BUS_ADDRESS',
                   'XDG_RUNTIME_DIR', 'XDG_CURRENT_DESKTOP', 'XDG_DATA_DIRS',
                   'XDG_CONFIG_DIRS', 'GTK_USE_PORTAL']) { delete env[v]; }
  const cmd = spawn('xvfb-run',
    ['--auto-servernum', '--server-args=-screen 0 1920x1080x24',
      process.execPath, __filename, ...argv],
    {stdio: 'inherit', env});
  cmd.on('exit', code => process.exit(code ?? 1));
  return true;
}

// Insist on "alive", not merely a response: the port opens before the server is
// ready, and answers /status with a 503 until then.
function waitForAlive(port, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const again = () => {
      if (Date.now() > deadline) { return reject(new Error('server never reported itself alive')); }
      setTimeout(attempt, 250);
    };
    const attempt = () => {
      const req = http.get(`http://localhost:${port}/status`, (res) => {
        let body = '';
        res.on('data', (d) => { body += d; });
        res.on('end', () => (res.statusCode === 200 && /alive/.test(body)) ? resolve() : again());
      });
      req.on('error', again);
      req.setTimeout(1000, () => req.destroy());
    };
    attempt();
  });
}

// Run the app as a server and point the tests at it over HOME_URL, rather than
// letting chromedriver launch it as the browser.
async function runDeployment(mochaBin, appEntry, testFiles) {
  const port = parseInt(process.env.GRIST_PORT || '8686', 10);
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'grist-desktop-deploy-'));
  // Outside the state dir, which is torn down on the way out: when a test fails
  // the server's own account of what happened is usually the only place the
  // reason is recorded, and by then it is too late to go looking for it.
  const logDir = process.env.GRIST_TEST_LOG_DIR || path.join(ROOT, 'test-logs');
  fs.mkdirSync(logDir, {recursive: true});
  const logPath = path.join(logDir, 'deployment-app.log');
  const logFd = fs.openSync(logPath, 'w');

  const appEnv = {
    ...process.env,
    GRIST_PORT: String(port),
    GRIST_DESKTOP_AUTH: 'none',
    // Core prefers its own login system to the deployment's when this is set, so
    // desktop's single-user login steps aside and the borrowed suites work
    // unchanged. It also seeds the support user's key from TEST_SUPPORT_API_KEY.
    GRIST_TEST_LOGIN: '1',
    GRIST_SESSION_COOKIE: 'grist_test_cookie',
    TEST_SUPPORT_API_KEY: 'api_key_for_support',
    // The rest of what core gives a server it tests against; see the docker run
    // in core/test/test_under_docker.sh and core/test/test_env.sh.
    GRIST_IN_SERVICE: 'true',
    LANGUAGE: 'en_US',
    GRIST_INST_DIR: path.join(state, 'inst'),
    GRIST_DATA_DIR: path.join(state, 'docs'),
    TYPEORM_DATABASE: path.join(state, 'landing.db'),
  };
  // No GRIST_SANDBOX_FLAVOR: the point is to use the one we ship.
  delete appEnv.GRIST_SANDBOX_FLAVOR;
  fs.mkdirSync(appEnv.GRIST_INST_DIR, {recursive: true});
  fs.mkdirSync(appEnv.GRIST_DATA_DIR, {recursive: true});

  const bin = process.env.GRIST_DESKTOP_BIN;
  const app = bin
    ? spawn(bin, [], {stdio: ['ignore', logFd, logFd], env: appEnv})
    : spawn(require('electron'), ['--no-sandbox', appEntry],
      {stdio: ['ignore', logFd, logFd], env: appEnv});

  let finished = false;
  const finish = (code) => {
    if (finished) { return; }
    finished = true;
    app.kill();
    const log = fs.readFileSync(logPath, 'utf8');
    // Say which sandbox ran: using the one we ship is the point of this mode.
    const flavors = [...new Set(log.match(/flavor=[a-zA-Z]+/g) || [])];
    if (flavors.length) { console.log(`[sandbox used: ${flavors.join(' ')}]`); }
    if (code !== 0) {
      console.log("--- last of the app's output ---");
      console.log(log.split('\n').slice(-30).join('\n'));
      console.log(`--- all of it: ${logPath} ---`);
    }
    fs.closeSync(logFd);
    if (!process.env.KEEP_TMPDIR) { fs.rmSync(state, {recursive: true, force: true}); }
    process.exit(code);
  };
  process.on('SIGINT', () => finish(1));
  process.on('SIGTERM', () => finish(1));
  // The app quitting is only a failure while we still need it. Once mocha has
  // reported, its exit code is the answer, and on windows the app can go first.
  let mochaRunning = false;
  app.on('exit', () => { if (!mochaRunning) { finish(1); } });

  console.log(`[waiting for server on :${port}]`);
  try { await waitForAlive(port); } catch (e) {
    console.error(String(e.message || e));
    return finish(1);
  }
  console.log('[server alive]');

  // Upstream's helpers budget for a sandbox that starts in milliseconds; the one
  // this mode exists to exercise takes seconds. deployment-timeouts.js raises
  // their floor to this, and mocha's own limit then has to leave room for a
  // handful of them -- a suite that creates a document can spend two before it
  // has run any of its own code.
  const serverTimeout = parseInt(process.env.GRIST_TEST_SERVER_TIMEOUT || '30000', 10);
  // A cold browser start takes longer than mocha-webdriver's own 20s setup hook
  // allows on a windows runner, so the hooks need more room regardless.
  //
  // This is only a default. Several upstream suites declare this.timeout(20000)
  // of their own, and a suite's own number wins over the command line, so the
  // plugin has to raise those from the inside; it is given the same number here
  // rather than recomputing it.
  const testTimeout = Math.max(60000, serverTimeout * 3);

  // Run mocha from core's directory, as core runs it. Mocha finds its config by
  // searching up from the cwd, so this is what loads the "mocha" block in
  // core/package.json -- the six requires every core mocha run has and the
  // borrowed suites are written to expect. Running from this repo's root found
  // no config at all and loaded none of them, silently. Two of them matter here:
  // setupPaths computes its module paths from process.cwd(), so nothing but the
  // right cwd will do, and init-mocha-webdriver settles window size, chai's
  // truncation threshold, stacktraces, browser choice, and suppression of the
  // "controlled by automated software" banner, which upstream turns off because
  // it can swallow early clicks. We had been re-deriving pieces of those two by
  // hand -- NODE_PATH, SELENIUM_BROWSER -- one visible failure at a time, and
  // getting only the pieces whose absence was visible.
  const child = spawn(process.execPath,
    [mochaBin, '--reporter', 'spec', '--slow', '8000', '--timeout', String(testTimeout),
      '--require', path.join(ROOT, 'test/electron/deployment-timeouts.js'),
      '--require', path.join(ROOT, 'test/electron/failure-dump.js'),
      // Throwaway; goes with test/probes/. Each gated, so each is one line to drop.
      ...(process.env.GRIST_TEST_SOCKET_TRACE ?
        ['--require', path.join(ROOT, 'test/probes/socket-trace.js')] : []),
      ...(process.env.GRIST_TEST_NO_IDLE_TIMER ?
        ['--require', path.join(ROOT, 'test/probes/no-idle-timer.js')] : []),
      ...(process.env.GRIST_TEST_UNHOOK_TIMEOUT ?
        ['--require', path.join(ROOT, 'test/probes/unhook-timeout.js')] : []),
      ...(process.env.GRIST_TEST_AXIOS_POOL ?
        ['--require', path.join(ROOT, 'test/probes/axios-own-pool.js')] : []),
      ...testFiles],
    {stdio: 'inherit', cwd: path.join(ROOT, 'core'), env: {
      ...process.env,

      // What core sets for its own nbrowser runs: test/test_env.sh, the
      // test:nbrowser script in its package.json, and the nbrowser jobs in its
      // CI workflow. Headless is not a detail -- core's testUtils registers a
      // mocha-webdriver options hook that fixes the window at 1920x1080 when it
      // is set, so this is the geometry upstream actually validates these suites
      // at. Without it the window is whatever the runner's desktop gives, which
      // differs per platform.
      MOCHA_WEBDRIVER_HEADLESS: '1',
      LANGUAGE: 'en_US',
      GRIST_SESSION_COOKIE: 'grist_test_cookie',
      TEST_SUPPORT_API_KEY: 'api_key_for_support',
      TEST_ACCOUNT_PASSWORD: 'not-needed',

      // What this mode needs on top, and nothing else.
      HOME_URL: `http://localhost:${port}`,
      GRIST_TEST_SERVER_TIMEOUT: String(serverTimeout),
      GRIST_TEST_TIMEOUT: String(testTimeout),
      // Where failure-dump.js writes; the same directory CI already collects.
      GRIST_TEST_DUMP_DIR: logDir,
      // Upstream's own per-failure capture (mocha-webdriver's enableDebugCapture,
      // which every suite installs through setupTestSuite) is keyed on this and
      // does nothing without it. It costs a screenshot and the browser console
      // for each failed test, which is the one log we have never had.
      MOCHA_WEBDRIVER_LOGDIR: logDir,
      MOCHA_WEBDRIVER_LOGTYPES: 'browser',
      // mocha-webdriver builds its own chrome service with no driver path, so
      // selenium goes looking. Put ours where it will be found first, rather
      // than let Selenium Manager download one mid-test.
      PATH: [path.dirname(require('chromedriver').path), process.env.PATH].join(path.delimiter),
    }});
  mochaRunning = true;
  child.on('exit', code => finish(code ?? 1));
}

function main() {
  const argv = process.argv.slice(2);
  if (maybeReexecUnderXvfb(argv)) { return; }

  const {mode, names} = parseArgs(argv);
  const {mochaBin, appEntry} = checkPrereqs();
  const testFiles = resolveTestFiles(mode, names);

  if (mode === 'deployment') { return runDeployment(mochaBin, appEntry, testFiles); }

  const args = [
    '--reporter', 'spec',
    '--slow', '10000',
    '--require', path.join(ROOT, 'test/electron/setup.js'),
    ...testFiles,
  ];
  const child = spawn(process.execPath, [mochaBin, ...args],
    {stdio: 'inherit', cwd: ROOT, env: buildEnv(mode)});
  child.on('exit', code => process.exit(code ?? 1));
}

try { main(); }
catch (e) { console.error(String(e.message || e)); process.exit(1); }
