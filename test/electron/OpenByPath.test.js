/**
 * Opening a document by path, the way a double-click or a shell command does.
 *
 * No webdriver here: the app is started as its own process with a file argument,
 * and the question is only which file it decided to open. It records that in the
 * home database, as the document's externalId, so that is what gets checked --
 * before any window has to render, and without a session to authenticate.
 *
 * The relative case is the one worth having. Starting the Grist server chdirs to
 * the app root, so a path resolved any later than argument parsing resolves
 * against the wrong directory, and the app quietly registers a new empty
 * document there instead of opening the one that was asked for.
 */

const {assert} = require('chai');
const {spawn, spawnSync} = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const sqlite3 = require('@gristlabs/sqlite3');

const ROOT = path.resolve(__dirname, '..', '..');
const APP_ENTRY = path.join(ROOT, 'core/_build/ext/app/electron/main.js');
const FIXTURE = path.join(ROOT, 'core/test/fixtures/docs/World.grist');
const ELECTRON_BIN = require('electron');

// Cold start, plus a home database to migrate. Windows is the slow one.
const OPEN_TIMEOUT = 90_000;

describe('OpenByPath', function () {
  this.timeout(OPEN_TIMEOUT + 30_000);

  let app = null;
  let workDir = null;

  afterEach(async function () {
    if (app) { await stopApp(app); app = null; }
    if (workDir && !process.env.KEEP_TMPDIR) {
      fs.rmSync(workDir, {recursive: true, force: true});
    }
    workDir = null;
  });

  it('opens the document at an absolute path', async function () {
    const {docDir} = prepare();
    app = await startApp({cwd: docDir, arg: path.join(docDir, 'world.grist')});
    assert.equal(await openedDocPath(), path.join(docDir, 'world.grist'));
  });

  it('opens the document at a path relative to where the command ran', async function () {
    const {docDir} = prepare();
    // Deliberately started from the document's own directory, with a bare name:
    // resolving this anywhere but here picks a file that does not exist.
    app = await startApp({cwd: docDir, arg: 'world.grist'});
    assert.equal(await openedDocPath(), path.join(docDir, 'world.grist'));
  });

  // --- helpers ---

  let dbPath = null;

  /**
   * Lays out a work directory: a copy of a fixture document to open, and the
   * state directories the app expects, kept well away from the user's own.
   */
  function prepare() {
    // realpath because macOS hands out temporary directories through a symlink,
    // and the app reports the resolved path its own cwd gives it.
    workDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'grist-desktop-open-')));
    const docDir = path.join(workDir, 'papers');
    fs.mkdirSync(docDir);
    fs.copyFileSync(FIXTURE, path.join(docDir, 'world.grist'));
    for (const dir of ['inst', 'docs', 'userroot']) {
      fs.mkdirSync(path.join(workDir, dir), {recursive: true});
    }
    dbPath = path.join(workDir, 'landing.db');
    return {docDir};
  }

  async function startApp({cwd, arg}) {
    if (!fs.existsSync(APP_ENTRY)) { throw new Error(`no app at ${APP_ENTRY}; run yarn build`); }
    const env = {
      ...process.env,
      GRIST_PORT: String(await freePort()),
      GRIST_DESKTOP_AUTH: 'strict',
      GRIST_SANDBOX_FLAVOR: 'unsandboxed',
      GRIST_INST_DIR: path.join(workDir, 'inst'),
      GRIST_DATA_DIR: path.join(workDir, 'docs'),
      GRIST_USER_ROOT: path.join(workDir, 'userroot'),
      TYPEORM_DATABASE: dbPath,
      GRIST_LOG_LEVEL: 'warn',
      // The app resolves its own modules against the cwd when it is not packaged,
      // and the cwd here is the document's directory, not the build tree.
      NODE_PATH: [
        path.join(ROOT, 'core/_build/ext'),
        path.join(ROOT, 'core/_build/stubs'),
        path.join(ROOT, 'core/_build'),
      ].join(path.delimiter),
    };
    // setup.js sets this for the suites that run under webdriver. A second app
    // binding the same socket fails, and then never opens a window.
    delete env.GRIST_TESTING_SOCKET;

    const logPath = path.join(workDir, 'app.log');
    const logFd = fs.openSync(logPath, 'w');
    const args = ['--no-sandbox'];
    // Match what the webdriver harness does: use the Xvfb display, not a
    // Wayland session that may be running on a developer's machine.
    if (process.platform === 'linux') { args.push('--ozone-platform=x11'); }
    const child = spawn(ELECTRON_BIN, [...args, APP_ENTRY, arg],
      {cwd, env, stdio: ['ignore', logFd, logFd]});
    child.on('error', (e) => console.error(`could not start the app: ${e.message}`));
    child.logPath = logPath;
    child.logFd = logFd;
    return child;
  }

  /**
   * Waits for the app to register a document, and answers with the file it
   * bound that document to. Polling the database is also the wait: the row
   * appears as the document is registered, well before its window is drawn.
   */
  async function openedDocPath() {
    const deadline = Date.now() + OPEN_TIMEOUT;
    while (Date.now() < deadline) {
      const docs = await readDocs();
      if (docs.length > 1) {
        assert.fail(`expected one document, got ${JSON.stringify(docs)}`);
      }
      if (docs.length === 1) {
        const externalId = JSON.parse(docs[0].options || '{}').externalId;
        if (externalId) { return externalId; }
      }
      if (app.exitCode !== null || app.signalCode !== null) {
        throw new Error(`the app stopped before opening anything:\n${tailLog()}`);
      }
      await delay(250);
    }
    throw new Error(`no document was registered within ${OPEN_TIMEOUT}ms:\n${tailLog()}`);
  }

  function readDocs() {
    return new Promise((resolve) => {
      if (!fs.existsSync(dbPath)) { return resolve([]); }
      const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
        if (err) { return resolve([]); }
        // The table is mid-migration for a moment, so a failed read is a retry.
        db.all('SELECT id, name, options FROM docs', (e, rows) => {
          db.close();
          resolve(e ? [] : rows);
        });
      });
    });
  }

  function tailLog() {
    try { return fs.readFileSync(app.logPath, 'utf8').split('\n').slice(-20).join('\n'); }
    catch (e) { return `(no log: ${e.message})`; }
  }
});

/**
 * Waits for the app to be gone, not merely signalled: it holds the home database
 * open, and Windows will not let the directory go while it lives. Windows also
 * has no process group, so the whole tree has to be named.
 */
function stopApp(child) {
  return new Promise((resolve) => {
    const done = () => {
      try { fs.closeSync(child.logFd); } catch (e) { /* already closed */ }
      resolve();
    };
    if (child.exitCode !== null || child.signalCode !== null) { return done(); }
    child.once('exit', done);
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    } else {
      child.kill();
      setTimeout(() => child.kill('SIGKILL'), 5000).unref();
    }
    setTimeout(done, 10_000).unref();
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const {port} = server.address();
      server.close(() => resolve(port));
    });
  });
}

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
