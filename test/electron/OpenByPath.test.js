/**
 * Opening a document by path, the way a double-click or a shell command does.
 *
 * No webdriver here: the app is started as its own process, and the question is
 * only which file it decided to open. It records that in the home database, as
 * the document's externalId, so that is what gets checked -- before any window
 * has to render, and without a session to authenticate.
 *
 * The relative case is the one worth having. Starting the Grist server chdirs to
 * the app root, so a path resolved any later than argument parsing resolves
 * against the wrong directory, and the app quietly registers a new empty
 * document there instead of opening the one that was asked for.
 *
 * The last two cases cover the other way in, which macOS uses: the path arrives
 * as an open-file event rather than in argv. Finder and the dock cannot be
 * driven from a test, so the app raises the event itself, at the two moments
 * that used to lose it -- before the command line is parsed, where the parser
 * overwrote the path with nothing, and during startup, which finished after the
 * path had already been read. Only the delivery is left untested.
 */

const {assert} = require('chai');
const {spawn} = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const {OpenMode, SQLiteDB} = require('app/server/lib/SQLiteDB');
const {delay} = require('app/common/delay');
const {removeWorkDir, stopApp} = require('./appProcess');

const ROOT = path.resolve(__dirname, '..', '..');
const APP_ENTRY = path.join(ROOT, 'core/_build/ext/app/electron/main.js');
const FIXTURE = path.join(ROOT, 'core/test/fixtures/docs/World.grist');
const ELECTRON_BIN = require('electron');

// Cold start, plus a home database to migrate. Windows is the slow one.
const OPEN_TIMEOUT = parseInt(process.env.GRIST_TEST_OPEN_TIMEOUT || '90000', 10);

describe('OpenByPath', function () {
  this.timeout(OPEN_TIMEOUT + 30_000);

  let app = null;
  let workDir = null;
  let docDir = null;
  let doc = null;
  let dbPath = null;
  let logFd = null;

  afterEach(async function () {
    if (app) { await stopApp(app); app = null; }
    // Only once the app is gone: on Windows its own handles outlive the signal.
    if (logFd !== null) { fs.closeSync(logFd); logFd = null; }
    if (workDir && !process.env.KEEP_TMPDIR) {
      removeWorkDir(workDir);
    }
    workDir = null;
  });

  it('opens the document at an absolute path', async function () {
    prepare();
    app = await startApp({arg: doc});
    assert.equal(await openedDocPath(), doc);
  });

  it('opens the document at a path relative to where the command ran', async function () {
    prepare();
    // A bare name, with the app started from the document's own directory:
    // resolving this anywhere else picks a file that does not exist.
    app = await startApp({arg: 'world.grist'});
    assert.equal(await openedDocPath(), doc);
  });

  it('opens a document handed over before the command line is parsed', async function () {
    prepare();
    app = await startApp({openFileWhen: 'before-parse'});
    assert.equal(await openedDocPath(), doc);
  });

  it('opens a document handed over while the app is starting', async function () {
    prepare();
    app = await startApp({openFileWhen: 'during-startup'});
    assert.equal(await openedDocPath(), doc);
  });

  /**
   * Lays out a work directory: a copy of a fixture document to open, and the
   * state directories the app expects, kept well away from the user's own.
   */
  function prepare() {
    // realpath because macOS hands out temporary directories through a symlink,
    // and the app reports the resolved path its own cwd gives it.
    workDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'grist-desktop-open-')));
    docDir = path.join(workDir, 'papers');
    doc = path.join(docDir, 'world.grist');
    fs.mkdirSync(docDir);
    fs.copyFileSync(FIXTURE, doc);
    for (const dir of ['inst', 'docs', 'userroot']) { fs.mkdirSync(path.join(workDir, dir)); }
    dbPath = path.join(workDir, 'landing.db');
  }

  /**
   * Starts the app from the document's directory, either with a path in argv or
   * with one to be handed over as an open-file event.
   */
  async function startApp({arg, openFileWhen}) {
    const env = {
      ...process.env,
      GRIST_PORT: String(await freePort()),
      // Lets the app stand in for the desktop, and stubs the dialogs a failure
      // to open would otherwise put on someone's screen.
      GRIST_DESKTOP_TEST_MODE: '1',
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
    if (openFileWhen) {
      env.GRIST_DESKTOP_TEST_OPEN_FILE = doc;
      env.GRIST_DESKTOP_TEST_OPEN_FILE_WHEN = openFileWhen;
    }

    const args = ['--no-sandbox'];
    // Match what the webdriver harness does: use the Xvfb display, not a
    // Wayland session that may be running on a developer's machine.
    if (process.platform === 'linux') { args.push('--ozone-platform=x11'); }
    logFd = fs.openSync(path.join(workDir, 'app.log'), 'w');
    // The handover cases pass no path in argv, as macOS does not.
    const child = spawn(ELECTRON_BIN, [...args, APP_ENTRY, ...(arg ? [arg] : [])],
      {cwd: docDir, env, stdio: ['ignore', logFd, logFd]});
    child.on('error', (e) => console.error(`could not start the app: ${e.message}`));
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
      if (docs.length > 1) { assert.fail(`expected one document, got ${JSON.stringify(docs)}`); }
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

  /**
   * The documents the app has registered so far, or none if it has not got as
   * far as making the database, or is midway through migrating it.
   */
  async function readDocs() {
    if (!fs.existsSync(dbPath)) { return []; }
    let db = null;
    try {
      db = await SQLiteDB.openDBRaw(dbPath, OpenMode.OPEN_READONLY);
      return await db.all('SELECT name, options FROM docs');
    } catch (e) {
      return [];
    } finally {
      if (db) { await db.close(); }
    }
  }

  function tailLog() {
    try {
      return fs.readFileSync(path.join(workDir, 'app.log'), 'utf8').split('\n').slice(-20).join('\n');
    } catch (e) {
      return `(no log: ${e.message})`;
    }
  }
});

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
