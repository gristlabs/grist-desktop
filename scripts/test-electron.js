#!/usr/bin/env node
/*
 * Runs the app's browser tests, in one of three modes:
 *
 *   scripts/test-electron.js                    # our own tests
 *   scripts/test-electron.js --upstream         # core's suites, app as browser
 *   scripts/test-electron.js --upstream Foo Bar # named suites, same mode
 *   scripts/test-electron.js --deployment       # core's suites, app as server
 *
 * The first two make the app's own window impersonate a browser, through the
 * shims in test/electron/setup.js, and default the sandbox to unsandboxed.
 *
 * Deployment mode instead runs the app as an ordinary Grist server and points a
 * separate headless Chrome at it, the way core runs these suites against a server
 * in docker (see core/test/test_under_docker.sh). No shims are involved, and the
 * app uses the sandbox it ships with. GRIST_DESKTOP_BIN runs a packaged binary
 * instead of the build tree.
 */

const {spawn, spawnSync} = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const IS_LINUX = process.platform === 'linux';
const HEADLESS = process.env.HEADLESS !== '0';

// Upstream nbrowser suites known to pass against the desktop.
const DEFAULT_UPSTREAM_SUITES = [
  'ActionLog', 'ChoiceList', 'ColumnTransform', 'CopyPasteLinked',
  'DetailView', 'DuplicateDocument', 'FilteringBugs', 'LeftPanel',
  'MultiColumn1', 'MultiColumn3', 'Pages', 'RowMenu', 'ToggleColumns',
];

// The two extra suites do not run in the window modes.
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
    if (names.length > 0) { throw new Error('local mode runs only our own tests; no names'); }
    return [
      path.join(ROOT, 'test/electron/Smoke.test.js'),
      path.join(ROOT, 'test/electron/OpenByPath.test.js'),
    ];
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
  // GRIST_DESKTOP_BIN brings its own app, so the build tree need not hold one.
  if (!process.env.GRIST_DESKTOP_BIN && !fs.existsSync(appEntry)) {
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

/**
 * On Linux with no display, re-execs under xvfb-run so the BrowserWindow has one,
 * and clears the host session variables so native dialogs (file pickers and the
 * like) cannot escape to the desktop through xdg-desktop-portal.
 */
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

function isAlive(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/status`, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve(res.statusCode === 200 && /alive/.test(body)));
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => req.destroy());
  });
}

/**
 * Rejects if anything already answers on the port. Without this the app would fail
 * to bind, isAlive() would pass on the first poll, and the suites would run against
 * whatever is already there.
 */
function ensurePortFree(port) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:${port}/`, (res) => {
      res.resume();
      reject(new Error(`port ${port} is already serving HTTP; set GRIST_PORT to a free one`));
    });
    req.on('error', () => resolve());
    req.setTimeout(500, () => { req.destroy(); resolve(); });
  });
}

/**
 * Waits for the server to report itself alive. A response is not enough: the port
 * opens before the server is ready, and answers /status with a 503 until then.
 */
async function waitForAlive(app, port, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isAlive(port)) { return; }
    if (!app.pid || app.exitCode !== null || app.signalCode !== null) {
      throw new Error('the app stopped before its server came up');
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('server never reported itself alive');
}

/**
 * The environment core gives a server it tests against; see the docker run in
 * core/test/test_under_docker.sh and core/test/test_env.sh. Also makes the state
 * directories, since the app expects to find them.
 */
function prepareAppEnv(port, state) {
  const env = {
    ...process.env,
    GRIST_PORT: String(port),
    GRIST_DESKTOP_AUTH: 'none',
    // Core prefers its own login system when this is set, so desktop's single-user
    // login steps aside and the borrowed suites work unchanged. It also seeds the
    // support user's key from TEST_SUPPORT_API_KEY.
    GRIST_TEST_LOGIN: '1',
    GRIST_SESSION_COOKIE: 'grist_test_cookie',
    TEST_SUPPORT_API_KEY: 'api_key_for_support',
    GRIST_IN_SERVICE: 'true',
    LANGUAGE: 'en_US',
    GRIST_INST_DIR: path.join(state, 'inst'),
    GRIST_DATA_DIR: path.join(state, 'docs'),
    TYPEORM_DATABASE: path.join(state, 'landing.db'),
  };
  // No GRIST_SANDBOX_FLAVOR: the point is to use the one we ship.
  delete env.GRIST_SANDBOX_FLAVOR;
  fs.mkdirSync(env.GRIST_INST_DIR, {recursive: true});
  fs.mkdirSync(env.GRIST_DATA_DIR, {recursive: true});
  return env;
}

/**
 * Kills the app and waits for it to actually exit, not just for the signal to be
 * sent: it holds the state directory's sqlite files open, and Windows will not
 * delete those under a live process. Windows also has no process group to kill,
 * so taskkill is told to take the whole tree.
 */
function stopApp(app) {
  return new Promise((resolve) => {
    if (!app.pid || app.exitCode !== null || app.signalCode !== null) { return resolve(); }
    app.once('exit', resolve);
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(app.pid), '/T', '/F']);
    } else {
      app.kill();
      setTimeout(() => app.kill('SIGKILL'), 5000).unref();
    }
    setTimeout(resolve, 10000).unref();
  });
}

function reportAppLog(logPath, code) {
  const log = fs.readFileSync(logPath, 'utf8');
  // Say which sandbox ran: using the one we ship is the point of this mode.
  const flavors = [...new Set(log.match(/flavor=[a-zA-Z]+/g) || [])];
  if (flavors.length) { console.log(`[sandbox used: ${flavors.join(' ')}]`); }
  if (code !== 0) {
    console.log("--- last of the app's output ---");
    console.log(log.split('\n').slice(-30).join('\n'));
    console.log(`--- all of it: ${logPath} ---`);
  }
}

/**
 * Runs the suites against the server on `port`, and resolves with mocha's exit
 * code. Mocha runs from core's directory, as core runs it: mocha searches upwards
 * from the cwd for its config, so this is what picks up the "mocha" block in
 * core/package.json and the requires the borrowed suites expect; from anywhere else
 * it finds none of them, silently. core's setupPaths reads the cwd too.
 */
function runMocha(mochaBin, testFiles, port, logDir) {
  // The floor deployment-timeouts.js puts under upstream's server waits, which
  // budget for a sandbox that starts in milliseconds rather than seconds.
  const serverTimeout = parseInt(process.env.GRIST_TEST_SERVER_TIMEOUT || '30000', 10);
  // Room for a few of those in one test. The plugin gets it too, as the floor it
  // lifts the suites and hooks that declare a timeout of their own up to.
  const testTimeout = Math.max(60000, serverTimeout * 3);

  const child = spawn(process.execPath,
    [mochaBin, '--reporter', 'spec', '--slow', '8000', '--timeout', String(testTimeout),
      '--require', path.join(ROOT, 'test/electron/deployment-timeouts.js'),
      ...testFiles],
    {stdio: 'inherit', cwd: path.join(ROOT, 'core'), env: {
      ...process.env,

      // What core sets for its own nbrowser runs; see its test_under_docker.sh.
      // core's testUtils sizes the window only when headless, so HEADLESS=0 sets the
      // same geometry by hand rather than testing at whatever size Chrome opens at.
      MOCHA_WEBDRIVER_HEADLESS: HEADLESS ? '1' : '',
      MOCHA_WEBDRIVER_WINSIZE: '1920x1080',
      LANGUAGE: 'en_US',
      GRIST_SESSION_COOKIE: 'grist_test_cookie',
      TEST_SUPPORT_API_KEY: 'api_key_for_support',
      TEST_ACCOUNT_PASSWORD: 'not-needed',

      // What this mode adds on top.
      HOME_URL: `http://localhost:${port}`,
      GRIST_TEST_SERVER_TIMEOUT: String(serverTimeout),
      GRIST_TEST_TIMEOUT: String(testTimeout),
      // Upstream's per-failure capture (mocha-webdriver's enableDebugCapture, which
      // every suite installs through setupTestSuite) does nothing without this.
      MOCHA_WEBDRIVER_LOGDIR: logDir,
      MOCHA_WEBDRIVER_LOGTYPES: 'browser',
      // mocha-webdriver builds its chrome service with no driver path, so selenium
      // goes looking. Put ours first, rather than have Selenium Manager download one
      // mid-test.
      PATH: [path.dirname(require('chromedriver').path), process.env.PATH].join(path.delimiter),
    }});
  return new Promise(resolve => child.on('exit', code => resolve(code ?? 1)));
}

/**
 * Runs the app as a server and points the tests at it over HOME_URL, rather than
 * letting chromedriver launch it as the browser.
 */
async function runDeployment(mochaBin, appEntry, testFiles) {
  const port = parseInt(process.env.GRIST_PORT || '8686', 10);
  await ensurePortFree(port);
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'grist-desktop-deploy-'));
  // Kept outside the state dir, which is torn down on the way out: when a test
  // fails, the server's log is usually the only record of why.
  const logDir = process.env.GRIST_TEST_LOG_DIR || path.join(ROOT, 'test-logs');
  fs.mkdirSync(logDir, {recursive: true});
  const logPath = path.join(logDir, 'deployment-app.log');
  const logFd = fs.openSync(logPath, 'w');

  const bin = process.env.GRIST_DESKTOP_BIN;
  const [appCmd, appArgs] = bin ? [bin, []] : [require('electron'), ['--no-sandbox', appEntry]];
  const app = spawn(appCmd, appArgs,
    {stdio: ['ignore', logFd, logFd], env: prepareAppEnv(port, state)});
  // An unhandled 'error' event would be thrown. The wait below reports the failure;
  // this only says what it was.
  app.on('error', (e) => console.error(`could not start the app: ${e.message}`));

  let torndown = false;
  const teardown = async (code) => {
    if (torndown) { return; }
    torndown = true;
    await stopApp(app);
    fs.closeSync(logFd);
    reportAppLog(logPath, code);
    if (!process.env.KEEP_TMPDIR) {
      try { fs.rmSync(state, {recursive: true, force: true}); }
      catch (e) { console.log(`[left ${state} behind: ${e.code || e.message}]`); }
    }
    // Not process.exit: stdout is a pipe on CI, where writes are async, and
    // exiting here would drop everything printed above.
    process.exitCode = code;
  };
  // The only ways out that the flow below cannot await.
  process.on('SIGINT', () => teardown(1));
  process.on('SIGTERM', () => teardown(1));

  try {
    console.log(`[waiting for server on :${port}]`);
    await waitForAlive(app, port);
    console.log('[server alive]');
    const code = await runMocha(mochaBin, testFiles, port, logDir);
    if (app.exitCode !== null) {
      console.log(`[the app exited with code ${app.exitCode} before the tests finished]`);
    }
    await teardown(code);
  } catch (e) {
    console.error(String(e.message || e));
    await teardown(1);
  }
}

/**
 * Runs the tests against the app's own window, which test/electron/setup.js starts
 * and dresses up as a browser.
 */
function runWindowMode(mochaBin, mode, testFiles) {
  const child = spawn(process.execPath,
    [mochaBin, '--reporter', 'spec', '--slow', '10000',
      '--require', path.join(ROOT, 'test/electron/setup.js'),
      ...testFiles],
    {stdio: 'inherit', cwd: ROOT, env: buildEnv(mode)});
  child.on('exit', code => process.exit(code ?? 1));
}

function main() {
  const argv = process.argv.slice(2);
  if (maybeReexecUnderXvfb(argv)) { return; }

  const {mode, names} = parseArgs(argv);
  const {mochaBin, appEntry} = checkPrereqs();
  const testFiles = resolveTestFiles(mode, names);
  return mode === 'deployment'
    ? runDeployment(mochaBin, appEntry, testFiles)
    : runWindowMode(mochaBin, mode, testFiles);
}

Promise.resolve().then(main).catch((e) => {
  console.error(String(e.message || e));
  process.exit(1);
});
