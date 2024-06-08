import * as electron from "electron";
import * as fse from "fs-extra";
import * as gutil from "app/common/gutil";
import * as log from "app/server/lib/log";
import * as path from "path";
import * as shutdown from "app/server/lib/shutdown";
import * as winston from "winston";
import { GristDesktopAuthMode, getMinimalElectronLoginSystem } from "app/electron/logins";
import AppMenu from "app/electron/AppMenu";
import { FlexServer } from "app/server/lib/FlexServer";
import RecentItems from "app/common/RecentItems";
import { UpdateManager } from "app/electron/UpdateManager";
import { makeId } from "app/server/lib/idUtils";
import { main as mergedServerMain } from "app/server/mergedServerMain";
import { updateDb } from "app/server/lib/dbUtils";
import webviewOptions from "app/electron/webviewOptions";

export class GristApp {
  private flexServer: FlexServer;
  private app = electron.app;
  private appWindows = new Set();       // A set of all our window objects.
  private appHost: any = null;               // The hostname to connect to the local node server we start.
  private pendingPathToOpen: any = null;     // Path to open when app is started to open a document.

  // Function, set once the app is ready, that opens or focuses a window when Grist is started. It
  // is called on 'ready' and by onInstanceStart (triggered when starting another Grist instance).
  private onStartup: any = null;
  private credential: string = makeId();
  private shouldQuit = false;
  private authMode: GristDesktopAuthMode;

  public constructor() {
    this.authMode = process.env.GRIST_DESKTOP_AUTH as GristDesktopAuthMode;
  }

  public main() {
    if (!this.app.requestSingleInstanceLock()) {
      this.app.quit();
      this.shouldQuit = true;
    }
    this.app.on('second-instance', (_, argv, cwd) => {
      this.onInstanceStart(argv, cwd);
    });

    // limits access to the webview api, read the `webviewOptions` module documentation for more
    // information
    // TODO: check if this still works (has path information).
    webviewOptions.setOptions({
      preloadURL: `file://${__dirname}/webviewPreload.js`,
      nodeIntegration: false,
      enableWhiteListOnly: true,
    });
    
    // It would be nice to just return when shouldQuit is true, but that's a problem for some tools
    // (babel?), so we ... don't.
    // TODO: this is a super old comment, check if we can simplify now.
    if (this.shouldQuit) {
      return;
    }

    this.setupLogging();

    // On Windows, opening a file by double-clicking it invokes Grist with path as the first arg.
    // This is also a handy way to open files from the command line on Linux.
    if (process.argv[1] && fse.existsSync(process.argv[1])) {
     this.pendingPathToOpen = path.resolve(process.cwd(), process.argv[1]);
    }

    // This is triggered on Mac when opening a .grist file, e.g. by double-clicking on it.
    this.app.on('open-file', (_, path) => this.pendingPathToOpen = path);

    // on('ready') is too late to set up at this point, but whenReady will happily resolve if the
    // application is already ready.
    this.app.whenReady().then(() => this.onReady().catch(reportErrorAndStop));
  }

  private onInstanceStart(argv: any, workingDir: any) {
    argv = this.cleanArgv(argv);
    // Someone tried to run a second instance, we should either open a file or focus a window.
    log.debug("onInstanceStart %s in %s", JSON.stringify(argv), workingDir);
    if (this.onStartup) {
      this.onStartup(argv[1] ? path.resolve(workingDir, argv[1]) : null);
    }
  }

  private cleanArgv(argv: any) {
    // Ignoring flags starting with '-' which might be added by electron on Mac (See
    // https://phab.getgrist.com/T307).
    return argv.filter((arg: any) => !arg.startsWith('-'));
  }

  private openWindowForPath(path: string, openWith?: {loadURL: (url: string) => Promise<void>}) {
    // Create the browser window, and load the document.
    (openWith || this.createWindow()).loadURL(this.getUrl({doc: path}));
  }

  // Opens file at filepath for any accepted file type.
  private async handleOpen(serverMethods: any, filepath: string) {
    log.debug("handleOpen %s", filepath);
    const ext = path.extname(filepath);
    switch (ext) {
      case '.csv':
      case '.xlsx':
      case '.xlsm': {
          const docName = serverMethods.importDoc(filepath);
          this.openWindowForPath(docName);
          break;
      }
      default:
        await this.openGristFile(filepath).catch(e => this.reportError(e));
        break;
    }
  }

  private getUrl(options: {
    doc?: string,
  } = {}) {
    const url = new URL(this.appHost);
    if (options.doc) {
      url.pathname = 'doc/' + encodeURIComponent(options.doc);
    }
    if (this.authMode !== 'none') {
      url.searchParams.set('electron_key', this.credential);
    }
    return url.href;
  }

  private async openGristFile(filepath: string, openWith?: {loadURL: (url: string) => Promise<void>}) {
    const target = await this.normalizePath(filepath);
    const docsRoot = this.flexServer.docsRoot;
    const root = await this.normalizePath(docsRoot);
    console.log("Opening a file", {
      filepath,
      target,
      docsRoot,
      root,
    });

    // Here is our dumb strategy for opening random Grist files on the
    // file system: just mint a key and soft-link to them. If being
    // professional, Grist should be watching for external modifications.
    // Baby steps though.
    let docId: string|undefined;
    let maybeDocId: string|undefined;
    if (!path.relative(root, target).startsWith('..')) {
      const did = path.basename(target, '.grist');
      const p = path.join(docsRoot, `${did}.grist`);
      if (await this.normalizePath(p) === target) {
        maybeDocId = did;
      }
    }
    const db = this.flexServer.getHomeDBManager();
    const user = await db.getUserByLogin(process.env.GRIST_DEFAULT_EMAIL as string);
    if (!user) { throw new Error('cannot find default user'); }
    const wss = db.unwrapQueryResult(await db.getOrgWorkspaces({userId: user.id}, 0));
    for (const doc of wss[0].docs) {
      if (doc.options?.externalId === target || doc.id === maybeDocId) {
        docId = doc.id;
        break;
      }
    }
    if (!docId) {
      docId = db.unwrapQueryResult(await db.addDocument({
        userId: user.id,
      }, wss[0].id, {
        name: path.basename(target, '.grist'),
        options: { externalId: target },
      }));
    }
    const link = path.join(docsRoot, `${docId}.grist`);
    if (!await fse.pathExists(link)) {
      await fse.symlink(target, link, 'junction');
    }
    this.openWindowForPath(docId, openWith);
  }

  // Returns the last Grist window that was created.
  private getLastWindow() {
    let lastWindow = null;
    for (const win of this.appWindows) {
      lastWindow = win;
    }
    return lastWindow;
  }

  private createWindow() {
    const win = new electron.BrowserWindow({
      width: 1024,
      height: 768,
      webPreferences: {
        nodeIntegration: false,
        // TODO: check if this still works (has path information).
        preload: path.join(__dirname, 'preload.js'),
        webviewTag: true
      },
      backgroundColor: '#42494B',
      autoHideMenuBar: false,
    });

    // Add the window to the set of browser windows we maintain.
    this.appWindows.add(win);

    // Register for title updates
    win.on('page-title-updated', async (event, title) => {
      event.preventDefault();

      // Set represented filename (on macOS) to home directory if on Start page
      if (title === 'Home - Grist') {
        const docPath = this.app.getPath('documents');
        win.setTitle(path.basename(docPath));
        win.setRepresentedFilename(docPath);
      } else {
        let docPath = path.resolve(this.app.getPath('documents'), title);
        docPath += (path.extname(docPath) === '.grist' ? '' : '.grist');

        try {
          await fse.access(docPath);
          // If valid path, set to path
          win.setTitle(path.basename(docPath) + ' (' + path.dirname(docPath) + ')');
          win.setRepresentedFilename(docPath);
        } catch(err) {
          // If not valid path, leave title as-is and don't set the represented file
          win.setTitle(title);
          win.setRepresentedFilename('');
        }
      }
    });

    // If browser JS called window.open(), open it in an external browser if it's a non-local URL.
    win.webContents.setWindowOpenHandler((details) => {
      if (!gutil.startsWith(details.url, this.appHost)) {
        electron.shell.openExternal(details.url);
        return {action: "deny"};
      }
      return {action: "allow"};
    });

    // Remove the window from the set when it's closed.
    win.on('closed', () => {
      this.appWindows.delete(win);
    });
    return win;
  }

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
  private setupLogging() {
    const debugLogPath = (process.env.GRIST_LOG_PATH ||
      path.join(this.app.getPath('home'), 'grist_debug.log'));

    if (process.env.GRIST_LOG_PATH || fse.existsSync(debugLogPath)) {
      const output = fse.createWriteStream(debugLogPath, { flags: "a" });
      output.on('error', (err: any) => log.error("Failed to open %s: %s", debugLogPath, err));
      output.on('open', () => {
        log.info('Logging also to %s', debugLogPath);
        output.write('\n--- log starting by pid ' + process.pid + ' ---\n');

        const fileTransportOptions = {
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
  }

  private async onReady() {
    this.appHost = process.env.APP_HOME_URL;

    await updateDb();

    this.flexServer = await mergedServerMain(
      parseInt(process.env["GRIST_PORT"] as string, 10),
      ['home', 'docs', 'static', 'app'], {
        loginSystem: getMinimalElectronLoginSystem.bind(null, this.credential, this.authMode),
      });
    const serverMethods = this.flexServer.electronServerMethods;
    // This function is what we'll call now, and also in onInstanceStart. The latter is used on
    // Windows thanks to makeSingleInstance, and triggered when user clicks another .grist file.
    // We can only set this callback once we have serverMethods and appHost.
    this.onStartup = async (optPath: any) => {
      log.debug("onStartup %s", optPath);
      if (optPath) {
        await this.handleOpen(serverMethods, optPath);
        return;
      }
      const win = this.getLastWindow();
      if (win) {
        (win as any).show();
        return;
      }
      // We had no file to open, so open a window to the DocList.
      this.createWindow().loadURL(this.getUrl());
    };

    // Call onStartup immediately.
    this.onStartup(this.pendingPathToOpen);
    this.pendingPathToOpen = null;

    const recentItems = new RecentItems({
      maxCount: 10,
      intialItems: (await serverMethods.getUserConfig()).recentItems
    });
    const appMenu = new AppMenu(recentItems);
    electron.Menu.setApplicationMenu(appMenu.getMenu());
    const updateManager = new UpdateManager(appMenu);
    console.log(updateManager ? 'updateManager loadable, but not used yet' : '');

    // TODO: file new still does something, but it doesn't make a lot of sense.
    appMenu.on('menu-file-new', () => this.createWindow().loadURL(this.getUrl()));

    appMenu.on('menu-file-open', async () => {
      const result = await electron.dialog.showOpenDialog({
        title: 'Open existing Grist file',
        defaultPath: this.app.getPath('documents'),
        filters: [{ name: 'Grist files', extensions: ['grist'] }],
        // disabling extensions 'csv', 'xlsx', and 'xlsm' for the moment.
        properties: ['openFile']
      });
      const files = result.filePaths;
      if (files) {
        await this.handleOpen(serverMethods, files[0]);
      }
    });

    // If we get a request to show the Open-File dialog, do so, and load the result file if one
    // is selected.
    electron.ipcMain.on('show-open-dialog', async (ev) => {
      const result = await electron.dialog.showOpenDialog({
        title: 'Open existing Grist file',
        defaultPath: this.app.getPath('documents'),
        filters: [{ name: 'Grist files', extensions: ['grist'] }],
        properties: ['openFile']
      });
      const files = result.filePaths;
      if (files) {
        // ev.sender is the webContents object that sent this message.
        this.openGristFile(files[0], ev.sender);
      }
    });

    serverMethods.onDocOpen((filePath: string) => {
      // Add to list of recent docs in the dock (mac) or the JumpList (win)
      this.app.addRecentDocument(filePath);
      // Add to list of recent docs in the menu
      recentItems.addItem(filePath);
      serverMethods.updateUserConfig({ recentItems: recentItems.listItems() });
      // TODO: Electron does not yet support updating the menu except by reassigning the entire
      // menu.  There are proposals to allow menu templates include callbacks that
      // are called on menu open.  https://github.com/electron/electron/issues/528
      appMenu.rebuildMenu();
      electron.Menu.setApplicationMenu(appMenu.getMenu());
    });

    // serverMethods.onBackupMade((bakPath: string) => notifyMigrateBackup(bakPath));

    // Check for updates, and check again periodically (if user declines, it's the interval till
    // the next reminder, so too short would be annoying).
    //    if (updateManager.startAutoCheck()) {
    //      updateManager.schedulePeriodicChecks(6*3600);
    //    } else {
    //      log.warn("updateManager not starting (known not to work on Linux)");
    //    }

    // Now that we are ready, future 'open-file' events should just open windows directly.
    this.app.removeAllListeners('open-file');
    this.app.on('open-file', (_, filepath) => this.handleOpen(serverMethods, filepath));

    this.app.on('will-quit', function(event) {
      event.preventDefault();
      shutdown.exit(0);
    });

    // Quit when all windows are closed.
    this.app.on('window-all-closed', () => {
      this.app.quit();
    });

    // Plugins create <webview> elements with a "plugins" partition; here we add a special header
    // to all such requests. Requests for plugin content without this header will be rejected by
    // the server, to ensure that untrusted content is only loaded in protected <webview> elements.
    electron.session.fromPartition("plugins").webRequest.onBeforeSendHeaders((details, callback) => {
      details.requestHeaders["X-From-Plugin-WebView"] = "true";
      callback({requestHeaders: details.requestHeaders});
    });
  }

  private reportError(e: Error) {
    electron.dialog.showMessageBoxSync({
      type: "info",
      buttons: ["Ok"],
      message: "Error",
      detail: String(e)
    });
  }

  private async normalizePath(filepath: string) {
    // Use realpath if possible.
    try {
      filepath = await fse.realpath(filepath);
    } catch (e) {
      // if there's a problem, e.g. file doesn't exist or is symlink to
      // nowhere, don't panic.
    }
    return path.normalize(filepath);
  }
}

function reportErrorAndStop(e: Error) {
  console.error(e);
  process.exit(1);
}
