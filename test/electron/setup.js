// Mocha --require plugin: launches the desktop Electron binary via
// chromedriver, registers a WebDriver session with mocha-webdriver, connects
// to grist-core's testing-hooks socket, and shapes upstream's test/nbrowser
// `server` object so setupTestSuite() works without spawning anything.
//
// Spec: https://www.electronjs.org/docs/latest/tutorial/using-selenium-and-webdriver

const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const {Builder, Capabilities, Capability} = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

// Electron doesn't implement CDP's Browser domain, so chromedriver's
// Browser.getWindowForTarget fails. Fall back to JS-side dimensions.
const CDP_UNSUPPORTED = /getWindowForTarget|UnknownCommand/i;
(function patchSeleniumWindowMethods() {
  const Window = require('selenium-webdriver/lib/webdriver').Window;
  const origGetRect = Window.prototype.getRect;
  const origSetRect = Window.prototype.setRect;
  Window.prototype.getRect = async function () {
    try { return await origGetRect.call(this); }
    catch (e) {
      if (!CDP_UNSUPPORTED.test(String(e))) { throw e; }
      return await this.driver_.executeScript(
        'return {x:0,y:0,width:window.outerWidth,height:window.outerHeight}');
    }
  };
  Window.prototype.setRect = async function (rect) {
    try { return await origSetRect.call(this, rect); }
    catch (e) {
      if (!CDP_UNSUPPORTED.test(String(e))) { throw e; }
      await this.driver_.executeScript(
        `Object.defineProperty(window,'outerWidth',{configurable:true,value:${Number(rect.width)|0}});` +
        `Object.defineProperty(window,'outerHeight',{configurable:true,value:${Number(rect.height)|0}});`);
      return rect;
    }
  };
})();

const ELECTRON_BIN = path.join(REPO_ROOT, 'node_modules/electron/dist/electron');
const CHROMEDRIVER_BIN = path.join(REPO_ROOT, 'node_modules/chromedriver/lib/chromedriver/chromedriver');
const APP_ENTRY = path.join(REPO_ROOT, 'core/_build/ext/app/electron/main.js');

const PORT = parseInt(process.env.GRIST_PORT || '8585', 10);

// Set GRIST_TESTING_SOCKET so the desktop server creates the hook socket on
// startup; we connect to it from the test process below. Deliberately *not*
// setting HOME_URL — that flips upstream into "external server" mode, which
// drives login via HTTP form instead of testingHooks.
const TESTING_SOCKET = path.join(os.tmpdir(), `grist-desktop-testing-${process.pid}.sock`);
process.env.GRIST_TESTING_SOCKET = TESTING_SOCKET;
process.env.GRIST_DESKTOP_TEST_MODE = '1';
process.env.GRIST_PORT = String(PORT);
process.env.GRIST_SESSION_COOKIE = process.env.GRIST_SESSION_COOKIE || 'grist_test_cookie';
process.env.GRIST_DESKTOP_AUTH = process.env.GRIST_DESKTOP_AUTH || 'none';
process.env.GRIST_SANDBOX_FLAVOR = process.env.GRIST_SANDBOX_FLAVOR || 'unsandboxed';
process.env.GRIST_FORCE_LOGIN = process.env.GRIST_FORCE_LOGIN || 'false';
process.env.TEST_ACCOUNT_PASSWORD = process.env.TEST_ACCOUNT_PASSWORD || 'not-needed';
// Seeds the support user's API key — see addSupportUserIfPossible.
process.env.TEST_SUPPORT_API_KEY = process.env.TEST_SUPPORT_API_KEY || 'api_key_for_support';

const mw = require('mocha-webdriver');

let _tmpDir = null;
let _logFd = null;

function ensureBinariesExist() {
  for (const [label, p] of [['electron', ELECTRON_BIN],
                             ['chromedriver', CHROMEDRIVER_BIN],
                             ['app entry', APP_ENTRY]]) {
    if (!fs.existsSync(p)) { throw new Error(`${label} not found at ${p}; run yarn build`); }
  }
}

async function ensurePortFree(port) {
  await new Promise((resolve, reject) => {
    const probe = http.get(`http://localhost:${port}/`, (res) => {
      res.resume();
      reject(new Error(`port ${port} is already serving HTTP — set GRIST_PORT to a free port`));
    });
    probe.on('error', () => resolve());      // ECONNREFUSED → free
    probe.setTimeout(500, () => { probe.destroy(); resolve(); });
  });
}

function makeTempDir() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'grist-desktop-test-'));
  process.env.GRIST_INST_DIR = path.join(tmp, 'inst');
  process.env.GRIST_DATA_DIR = path.join(tmp, 'docs');
  process.env.TYPEORM_DATABASE = path.join(tmp, 'landing.db');
  fs.mkdirSync(process.env.GRIST_INST_DIR, {recursive: true});
  fs.mkdirSync(process.env.GRIST_DATA_DIR, {recursive: true});
  return tmp;
}

async function waitForServer(baseUrl, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise((resolve) => {
      const req = http.get(`${baseUrl}/status`, (res) => {
        res.resume(); resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(1000, () => { req.destroy(); resolve(false); });
    });
    if (ok) { return; }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`Grist server did not respond at ${baseUrl}/status within ${timeoutMs}ms`);
}

async function startDriver() {
  ensureBinariesExist();
  await ensurePortFree(PORT);
  _tmpDir = makeTempDir();

  const opts = new chrome.Options();
  opts.setChromeBinaryPath(ELECTRON_BIN);
  // Don't block navigation on unhandled JS dialogs / beforeunload prompts.
  opts.set(Capability.UNHANDLED_PROMPT_BEHAVIOR, {
    alert: 'ignore', beforeUnload: 'ignore', confirm: 'ignore',
    default: 'ignore', file: 'ignore', prompt: 'ignore',
  });
  const electronArgs = [`app=${APP_ENTRY}`, '--no-sandbox'];
  // Force X11 to use Xvfb DISPLAY rather than the host's Wayland session.
  if (process.platform === 'linux') { electronArgs.push('--ozone-platform=x11'); }
  opts.addArguments(...electronArgs);

  _logFd = fs.openSync(path.join(_tmpDir, 'chromedriver.log'), 'a');
  const service = new chrome.ServiceBuilder(CHROMEDRIVER_BIN)
    .addArguments('--disable-build-check')
    .addArguments('--verbose');
  service.setStdio(['ignore', _logFd, _logFd]);
  console.log(`[setup] chromedriver log: ${path.join(_tmpDir, 'chromedriver.log')}`);

  const driver = await new Builder()
    .forBrowser('chrome')
    .withCapabilities(Capabilities.chrome())
    .setChromeOptions(opts)
    .setChromeService(service)
    .build();

  mw.setDriver(driver);
  await waitForServer(`http://localhost:${PORT}`);
  // Only the borrowed Grist test suites need this extra setup. The desktop's
  // own checks (Smoke, Probe) just open the app and look at it, so we skip it
  // for them — which also lets them run without first building Grist's tests.
  if (process.env.GRIST_DESKTOP_TEST_UPSTREAM === '1') {
    await wireUpstreamTestServer();
  }
  return driver;
}

// Shape upstream's `server` object so `useServer(server)` and the various
// HomeUtil/gristUtils helpers find what they expect — testingHooks for
// login, database file path for support-user seeding, no-op lifecycle
// hooks since Electron is the server.
async function wireUpstreamTestServer() {
  const {connectTestingHooks} = require('app/server/lib/TestingHooks');
  const {server} = require('test/nbrowser/testServer');
  await waitForSocket(TESTING_SOCKET, 15_000);
  const hooks = await connectTestingHooks(TESTING_SOCKET);
  server.testingHooks = hooks;
  server.getTestingHooks = async () => hooks;
  server.getHost = () => `http://localhost:${PORT}`;
  server.isExternalServer = () => false;
  server._getDatabaseFile = () => process.env.TYPEORM_DATABASE;
  server.start = async () => {};
  server.stop = async () => {};
  server.resume = () => {};
  server.closeDatabase = async () => { server._dbManager = undefined; };
  return server;
}

async function waitForSocket(socketPath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(socketPath)) { return; }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`testing-hooks socket never appeared at ${socketPath}; ` +
    `did GristApp.addTestingHooks run?`);
}

async function stopDriver() {
  const driver = mw.setDriver(undefined);
  if (driver) {
    try { await driver.quit(); }
    catch (e) { console.warn('driver.quit failed:', e.message || e); }
  }
  if (_logFd !== null) {
    try { fs.closeSync(_logFd); }
    catch (e) { console.warn('closeSync(logFd) failed:', e.message || e); }
    _logFd = null;
  }
  if (_tmpDir && !process.env.KEEP_TMPDIR) {
    fs.rmSync(_tmpDir, {recursive: true, force: true});
  }
  _tmpDir = null;
}

exports.mochaHooks = {
  beforeAll: [async function () {
    this.timeout(60_000);
    await startDriver();
  }],
  afterAll: [async function () {
    this.timeout(15_000);
    await stopDriver();
  }],
};
