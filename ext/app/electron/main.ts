// Force some settings so that the electron build becomes usable again.
// TODO: add an easy way to open files not created within app (would probably
// require reviving a special document manager distinct from that used by server
// build)
process.env.GRIST_MINIMAL_LOGIN = 'true';
process.env.GRIST_FORCE_LOGIN = 'true';
process.env.GRIST_SINGLE_PORT = 'true';
process.env.GRIST_SERVE_SAME_ORIGIN = 'true';
process.env.GRIST_DEFAULT_PRODUCT = 'Free';
process.env.GRIST_ORG_IN_PATH = 'true';
process.env.APP_UNTRUSTED_URL = 'http://plugins.invalid';

const path           = require('path');
const build          = path.dirname(__dirname);
const appModulePath  = require('app-module-path');
appModulePath.addPath(build);

import * as version from 'app/common/version';

// Handle --version flag, which causes use to only print version, without running anything.
if (process.argv.includes('--version')) {
  console.log(`${version.version} (${version.gitcommit} on ${version.channel})`);
  process.exit(0);
}

import * as electron from 'electron';

const app         = electron.app; // Module to control application life.

process.env.TYPEORM_DATABASE = path.resolve(app.getPath('appData'), 'landing.db');

process.env.GRIST_SANDBOX_FLAVOR = 'unsandboxed';

const updateDb = require('app/server/lib/dbUtils').updateDb;

const childproc      = require('child_process');
const fs             = require('fs');
const os             = require('os');
const winston        = require('winston');
const Promise        = require('bluebird');
Promise.promisifyAll(fs);
Promise.promisifyAll(childproc);

const log            = require('app/server/lib/log');
const serverUtils    = require('app/server/lib/serverUtils');
const shutdown       = require('app/server/lib/shutdown');
const server         = require('app/electron/server');

const gutil          = require('app/common/gutil');
const RecentItems    = require('app/common/RecentItems');

const AppMenu        = require('app/electron/AppMenu');
const UpdateManager  = require('app/electron/UpdateManager');
const webviewOptions = require('app/electron/webviewOptions');



// Global variables.



var appWindows = new Set();       // A set of all our window objects.
var appHost: any = null;               // The hostname to connect to the local node server we start.
var pendingPathToOpen: any = null;     // Path to open when app is started to open a document.

// Function, set once the app is ready, that opens or focuses a window when Grist is started. It
// is called on 'ready' and by onInstanceStart (triggered when starting another Grist instance).
let onStartup: any = null;


let shouldQuit = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
  shouldQuit = true;
}
app.on('second-instance', (event, argv, cwd) => {
  onInstanceStart(argv, cwd);
});

// limits access to the webview api, read the `webviewOptions` module documentation for more
// information
webviewOptions.setOptions({
  preloadURL: `file://${__dirname}/webviewPreload.js`,
  nodeIntegration: false,
  enableWhiteListOnly: true,
});

function onInstanceStart(argv: any, workingDir: any) {
  argv = cleanArgv(argv);
  // Someone tried to run a second instance, we should either open a file or focus a window.
  log.debug("onInstanceStart %s in %s", JSON.stringify(argv), workingDir);
  if (onStartup) {
    onStartup(argv[1] ? path.resolve(workingDir, argv[1]) : null);
  }
}

function cleanArgv(argv: any) {
  // Ignoring flags starting with '-' which might be added by electron on Mac (See
  // https://phab.getgrist.com/T307).
  return argv.filter((arg: any) => !arg.startsWith('-'));
}

function createWindow() {
  var win = new electron.BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true
    },
    backgroundColor: '#42494B',
    autoHideMenuBar: false,
  });

  // Add the window to the set of browser windows we maintain.
  appWindows.add(win);

  // Register for title updates
  win.on('page-title-updated', (event, title) => {
    event.preventDefault();

    // Set represented filename (on macOS) to home directory if on Start page
    if (title === 'Home - Grist') {
      let docPath = app.getPath('documents');
      win.setTitle(path.basename(docPath));
      win.setRepresentedFilename(docPath);
    } else {
      let docPath = path.resolve(app.getPath('documents'), title);
      docPath += (path.extname(docPath) === '.grist' ? '' : '.grist');

      fs.accessAsync(docPath)
      .then(() => {
        // If valid path, set to path
        win.setTitle(path.basename(docPath) + ' (' + path.dirname(docPath) + ')');
        win.setRepresentedFilename(docPath);
      })
        .catch((err: any) => {
        // If not valid path, leave title as-is and don't set the represented file
        win.setTitle(title);
        win.setRepresentedFilename('');
      });
    }
  });

  // If browser JS called window.open(), open it in an external browser if it's a non-local URL.
  win.webContents.on('new-window', (e, url) => {
    if (!gutil.startsWith(url, appHost)) {
      e.preventDefault();
      electron.shell.openExternal(url);
    }
  });

  // Remove the window from the set when it's closed.
  win.on('closed', function() {
    appWindows.delete(win);
  });
  return win;
}

function openWindowForPath(path: string) {
  // Create the browser window, and load the document.
  createWindow().loadURL(appHost + "/doc/" + encodeURIComponent(path));
}

// Opens file at filepath for any accepted file type.
function handleOpen(serverMethods: any, filepath: string) {
  log.debug("handleOpen %s", filepath);
  var ext = path.extname(filepath);
  switch (ext) {
    case '.csv':
    case '.xlsx':
    case '.xlsm':
      serverMethods.importDoc(filepath).then((docName: any) => openWindowForPath(docName));
      break;
    default:
      openWindowForPath(filepath);
  }
}


// Returns the last Grist window that was created.
function getLastWindow() {
  let lastWindow = null;
  for (let win of appWindows) {
    lastWindow = win;
  }
  return lastWindow;
}

// Opens a nonBlocking messagebox notifying user of backup made
function notifyMigrateBackup(backupPath: string) {
  let msgBoxArgs = {
    type: "info",
    buttons: ["Ok"],
    message: "Backup Made",
    detail: "Your Grist document has been upgraded to have the latest " +
            "and greatest features.\n\nIn case anything goes wrong, " +
            "we've left a backup at:\n\n" + backupPath
  };

  // pass in a dummy callback so that the call doesn't block
  electron.dialog.showMessageBoxSync(msgBoxArgs as any, (() => null) as any);
}

// It would be nice to just return when shouldQuit is true, but that's a problem for some tools
// (babel?), so we wrap the rest of this file in this conditional.
if (!shouldQuit) {

/**
 * Generally, our debug log output is discarded when running on Mac as a standalone application.
 * For debug output, we will append log to ~/grist_debug.log, but only if it exists.
 *
 * So, to enable logging: `touch ~/grist_debug.log`
 * To disable logging:    `rm ~/grist_debug.log`
 * To clear the log:      `rm ~/grist_debug.log; touch ~/grist_debug.log`
 *
 * In summary:
 * - When running app from finder or "open" command, no debug output.
 * - When running from terminal as "Grist.app/Contents/MacOS/Grist, debug output goes to console.
 * - When ~/grist_debug.log exists, log also to that file.
 */
const debugLogPath = (process.env.GRIST_LOG_PATH ||
                      path.join(app.getPath('home'), 'grist_debug.log'));

if (process.env.GRIST_LOG_PATH || fs.existsSync(debugLogPath)) {
  var output = fs.createWriteStream(debugLogPath, { flags: "a" });
  output.on('error', (err: any) => log.error("Failed to open %s: %s", debugLogPath, err));
  output.on('open', () => {
    log.info('Logging also to %s', debugLogPath);
    output.write('\n--- log starting by pid ' + process.pid + ' ---\n');

    var fileTransportOptions = {
      name: 'debugLog',
      stream: output,
      level: 'debug',
      timestamp: log.timestamp,
      colorize: true,
      json: false
    };

    // TODO: This does not log HTTP requests to the file. For that we may want to use
    // "express-winston" module, and possibly update winston (we are far behind).
    log.add(winston.transports.File, fileTransportOptions);
    winston.add(winston.transports.File, fileTransportOptions);
  });
}

// On Windows, opening a file by double-clicking it invokes Grist with path as the first arg.
// This is also a handy way to open files from the command line on Linux.
if (process.argv[1] && fs.existsSync(process.argv[1])) {
  pendingPathToOpen = path.resolve(process.cwd(), process.argv[1]);
}


// This is triggered on Mac when opening a .grist file, e.g. by double-clicking on it.
app.on('open-file', function(event, path) {
  pendingPathToOpen = path;
});


// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.on('ready', function() {
  let hostPort = 47478;
  let untrustedPort = 47479;
  return Promise.try(() =>
    // The port doesn't matter, we only care to avoid interfering with something that another
    // application might want after we have bound it. We pick 47478 (phone number for GRIST).
    process.env.GRIST_TEST_PORT || serverUtils.getAvailablePort(hostPort)
  )
  // get available port for server
    .tap((port: any) => hostPort = port)
  // get available port for untrusted content
  .then(() => serverUtils.getAvailablePort(untrustedPort))
    .tap((port: any) => untrustedPort = port)
  .tap(() => appHost = "http://localhost:" + hostPort)
  .tap(() => updateDb())
  .then(() => server.start({
    userRoot: process.env.GRIST_USER_ROOT ||path.join(os.homedir(), '.grist'),
    docsRoot: process.env.GRIST_DATA_DIR || app.getPath('documents'),
    instanceRoot: path.join(process.env.GRIST_USER_DATA_DIR || app.getPath('userData')),
    host: 'localhost',
    port: hostPort,
    untrustedContent : process.env.APP_UNTRUSTED_URL || `http://localhost:${untrustedPort}`,
    serverMode: "electron",
  })
    .then((serverMethods: any) => {

    // This function is what we'll call now, and also in onInstanceStart. The latter is used on
    // Windows thanks to makeSingleInstance, and triggered when user clicks another .grist file.
    // We can only set this callback once we have serverMethods and appHost.
      onStartup = function(optPath: any) {
      log.debug("onStartup %s", optPath);
      if (optPath) {
        handleOpen(serverMethods, optPath);
        return;
      }
      let win = getLastWindow();
      if (win) {
        (win as any).show();
        return;
      }
      // We had no file to open, so open a window to the DocList.
      createWindow().loadURL(appHost);
    };

    // Call onStartup immediately.
    onStartup(pendingPathToOpen);
    pendingPathToOpen = null;

    let recentItems = new RecentItems({
      maxCount: 10,
      intialItems: serverMethods.getUserConfig().recentItems
    });
    let appMenu = new AppMenu(recentItems);
    electron.Menu.setApplicationMenu(appMenu.getMenu());
    let updateManager = new UpdateManager(appMenu);
    console.log(updateManager ? 'updateManager loadable, but not used yet' : '');

    appMenu.on('menu-file-new', () => createWindow().loadURL(appHost));
    appMenu.on('menu-file-open', () => electron.dialog.showOpenDialog({
      title: 'Open existing Grist file',
      defaultPath: app.getPath('documents'),
      filters: [{ name: 'Grist files', extensions: ['grist', 'csv', 'xlsx', 'xlsm'] }],
      properties: ['openFile']
    } as any, function (files: any) {
      if (files) handleOpen(serverMethods, files[0]);
    } as any));

    // If we get a requiest to show the Open-File dialog, do so, and load the result file if one
    // is selected.
    electron.ipcMain.on('show-open-dialog', (ev) => electron.dialog.showOpenDialog({
      title: 'Open existing Grist file',
      defaultPath: app.getPath('documents'),
      filters: [{ name: 'Grist files', extensions: ['grist'] }],
      properties: ['openFile']
    } as any, function (files: any) {
      if (files) {
        // ev.sender is the webContents object that sent this message.
        ev.sender.loadURL(appHost + "/doc/" + encodeURIComponent(files[0]));
      }
    } as any));


      serverMethods.onDocOpen((filePath: string) => {
      // Add to list of recent docs in the dock (mac) or the JumpList (win)
      app.addRecentDocument(filePath);
      // Add to list of recent docs in the menu
      recentItems.addItem(filePath);
      serverMethods.updateUserConfig({ recentItems: recentItems.listItems() });
      // TODO: Electron does not yet support updating the menu except by reassigning the entire
      // menu.  There are proposals to allow menu templates include callbacks that
      // are called on menu open.  https://github.com/electron/electron/issues/528
      appMenu.rebuildMenu();
      electron.Menu.setApplicationMenu(appMenu.getMenu());
    });


      serverMethods.onBackupMade((bakPath: string) => notifyMigrateBackup(bakPath));

    // Check for updates, and check again periodically (if user declines, it's the interval till
    // the next reminder, so too short would be annoying).
//    if (updateManager.startAutoCheck()) {
//      updateManager.schedulePeriodicChecks(6*3600);
//    } else {
//      log.warn("updateManager not starting (known not to work on Linux)");
//    }

    // Now that we are ready, future 'open-file' events should just open windows directly.
    app.removeAllListeners('open-file');
    app.on('open-file', function(event, filepath) {
      handleOpen(serverMethods, filepath);
    });

    app.on('will-quit', function(event) {
      event.preventDefault();
      shutdown.exit(0);
    });

    // Quit when all windows are closed.
    app.on('window-all-closed', function() {
      app.quit();
    });

    // Plugins create <webview> elements with a "plugins" partition; here we add a special header
    // to all such requests. Requests for plugin content without this header will be rejected by
    // the server, to ensure that untrusted content is only loaded in protected <webview> elements.
    electron.session.fromPartition("plugins").webRequest.onBeforeSendHeaders((details, callback) => {
      details.requestHeaders["X-From-Plugin-WebView"] = "true";
      callback({requestHeaders: details.requestHeaders});
    });
  }));
});


} // end if (!shouldQuit)
