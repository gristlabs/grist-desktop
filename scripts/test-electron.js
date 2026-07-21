#!/usr/bin/env node
/*
 * Cross-platform runner for the WebDriver-driven Electron test harness.
 * Replaces the Linux-only test_electron.sh.
 *
 * Usage:
 *   scripts/test-electron.js                    # local smoke
 *   scripts/test-electron.js --upstream         # core deployment Smoke
 *   scripts/test-electron.js --upstream Foo Bar # named upstream tests
 *
 * On Linux without a real display, wraps in xvfb-run and isolates D-Bus so
 * native dialogs can't escape to the host. macOS and Windows runners have a
 * display and run directly.
 */

const {spawn, spawnSync} = require('child_process');
const fs = require('fs');
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

function parseArgs(argv) {
  let mode = 'local';
  const rest = [...argv];
  if (rest[0] === '--upstream') { mode = 'upstream'; rest.shift(); }
  return {mode, names: rest};
}

function resolveTestFiles(mode, names) {
  if (mode === 'local') {
    if (names[0] === 'Probe') { return [path.join(ROOT, 'test/electron/Probe.test.js')]; }
    return [path.join(ROOT, 'test/electron/Smoke.test.js')];
  }
  const targets = names.length > 0 ? names : DEFAULT_UPSTREAM_SUITES;
  return targets.map(name => {
    for (const dir of ['deployment', 'nbrowser']) {
      const p = path.join(ROOT, 'core/_build/test', dir, `${name}.js`);
      if (fs.existsSync(p)) { return p; }
    }
    throw new Error(`test not found: ${name} (not in deployment/ or nbrowser/)`);
  });
}

function checkPrereqs() {
  const mochaBin = path.join(ROOT, 'core/node_modules/.bin', process.platform === 'win32' ? 'mocha.cmd' : 'mocha');
  if (!fs.existsSync(mochaBin)) {
    throw new Error(`mocha not found at ${mochaBin}; run yarn install first`);
  }
  const appEntry = path.join(ROOT, 'core/_build/ext/app/electron/main.js');
  if (!fs.existsSync(appEntry)) {
    throw new Error('build output missing; run yarn build first');
  }
  return {mochaBin};
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

function main() {
  const argv = process.argv.slice(2);
  if (maybeReexecUnderXvfb(argv)) { return; }

  const {mode, names} = parseArgs(argv);
  const {mochaBin} = checkPrereqs();
  const testFiles = resolveTestFiles(mode, names);

  const args = [
    '--reporter', 'spec',
    '--slow', '10000',
    '--require', path.join(ROOT, 'test/electron/setup.js'),
    ...testFiles,
  ];
  const child = spawn(mochaBin, args, {stdio: 'inherit', cwd: ROOT, env: buildEnv(mode)});
  child.on('exit', code => process.exit(code ?? 1));
}

try { main(); }
catch (e) { console.error(String(e.message || e)); process.exit(1); }
