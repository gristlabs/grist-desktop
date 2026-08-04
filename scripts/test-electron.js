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

// The same suites also pass in deployment mode, along with two that only
// deployment mode has been able to run.
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
  const logPath = path.join(state, 'app.log');
  const logFd = fs.openSync(logPath, 'a');

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
    }
    fs.closeSync(logFd);
    if (!process.env.KEEP_TMPDIR) { fs.rmSync(state, {recursive: true, force: true}); }
    process.exit(code);
  };
  process.on('SIGINT', () => finish(1));
  process.on('SIGTERM', () => finish(1));
  app.on('exit', () => finish(1));

  console.log(`[waiting for server on :${port}]`);
  try { await waitForAlive(port); } catch (e) {
    console.error(String(e.message || e));
    return finish(1);
  }
  console.log('[server alive]');

  const child = spawn(process.execPath,
    // A cold browser start takes longer than mocha-webdriver's own 20s setup
    // hook allows on a windows runner, so give the hooks more room.
    [mochaBin, '--reporter', 'spec', '--slow', '6000', '--timeout', '60000', ...testFiles],
    {stdio: 'inherit', cwd: ROOT, env: {
      ...process.env,
      NODE_PATH: [path.join(ROOT, 'core/_build'), path.join(ROOT, 'core/_build/ext'),
        path.join(ROOT, 'core/_build/stubs')].join(path.delimiter),
      HOME_URL: `http://localhost:${port}`,
      GRIST_SESSION_COOKIE: 'grist_test_cookie',
      TEST_ACCOUNT_PASSWORD: 'not-needed',
      SELENIUM_BROWSER: 'chrome',
      MOCHA_WEBDRIVER_IGNORE_CHROME_VERSION: '1',
    }});
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
