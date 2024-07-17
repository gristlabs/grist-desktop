import * as electron from "electron";
import * as fse from "fs-extra";
import * as gutil from "app/common/gutil";
import * as log from "app/server/lib/log";
import * as path from "path";
import * as shutdown from "app/server/lib/shutdown";
import * as winston from "winston";
import { GristDesktopAuthMode, getMinimalElectronLoginSystem } from "app/electron/logins";
import AppMenu from "app/electron/AppMenu";
import { DocRegistry } from "./DocRegistry";
import { FlexServer } from "app/server/lib/FlexServer";
import { MergedServer } from "app/server/MergedServer";
import RecentItems from "app/common/RecentItems";
import { UpdateManager } from "app/electron/UpdateManager";
import { makeId } from "app/server/lib/idUtils";
import { updateDb } from "app/server/lib/dbUtils";
import webviewOptions from "app/electron/webviewOptions";

const GRIST_DOCUMENT_FILTER = {name: "Grist documents", extensions: ["grist"]};

export class FileToOpen {
  private _path: string | undefined;
  public set path(docPath: string | undefined) {
    if (docPath === undefined) {
      this._path = undefined;
    } else {
      this._path = path.resolve(docPath);
    }
  }
  public get path() {
    return this._path;
  }
}

type InstanceHandoverInfo = {
  fileToOpen: string;
}

type NewDocument = {
  path: string,
  id: string
}


export class GristApp {

  private static _instance: GristApp; // The singleton instance.

  private readonly credential: string = makeId();
  // APP_HOME_URL is set by loadConfig
  private readonly appHost: string = process.env.APP_HOME_URL as string; // The hostname to connect to the local node server we start.
  private flexServer: FlexServer;
  private openDocs: Map<string, electron.BrowserWindow> = new Map();
  private authMode: GristDesktopAuthMode;
  public docRegistry: DocRegistry;

  private constructor() {
    this.setupLogging();
    this.authMode = process.env.GRIST_DESKTOP_AUTH as GristDesktopAuthMode;
  }

  public static get instance(): GristApp {
    if (!GristApp._instance) {
      GristApp._instance = new GristApp();
    }
    return GristApp._instance;
  }

  /**
   * Opens a Grist document at docPath.
   */
  private async openGristDocument(docPath: string) {
    log.debug(`Opening Grist document ${docPath}`);
    // Do we know about this document?
    let docId = this.docRegistry.lookupByPath(docPath);
    if (docId === null) {
      docId = await this.docRegistry.registerDoc(docPath);
      log.warn(`Document not found in home DB, assigned docId ${docId}`);
    } else {
      log.debug(`Got docId ${docId}`);
    }
    // Is it already open?
    const win = this.openDocs.get(docId);
    if (win !== undefined) {
      win.show();
    } else {
      const win = this.createWindow();
      win.loadURL(this.getUrl(docId));
      win.on("closed", () => this.openDocs.delete(docId as string));
      this.openDocs.set(docId, win);
    }
  }

  public async showWelcome() {
    this.createWindow().loadURL(this.getUrl());
  }

  /**
   * Opens the file at filepath. File can be of any accepted type, including grist, csv, and xls[x,m].
   */
  public async openFile(filepath: string) {
    log.debug(`Opening file ${filepath}`);
    const ext = path.extname(filepath);
    switch (ext) {
      case ".csv":
      case ".xlsx":
      case ".xlsm": {
        // TODO: We can do better: Create the Grist document in /tmp (or a similar location) and
        // ask the user to save manually to a location they prefer.
        const doc = await this.flexServer.electronServerMethods.importDoc(filepath);
        const docPath = path.resolve(process.env.GRIST_DATA_DIR as string, doc.id, ".grist");
        this.openGristDocument(docPath);
        break;
      }
      default:
        await this.openGristDocument(filepath).catch(e => this.reportError(e));
        break;
    }
  }

  public async run(docOpen: FileToOpen) {

    electron.app.on("second-instance", (_e, _argv, _cwd, _additionalData) => {
      const instanceHandoverInfo = _additionalData as InstanceHandoverInfo;
      this.openFile(instanceHandoverInfo["fileToOpen"]);
    });

    // limits access to the webview api, read the `webviewOptions` module documentation for more
    // information
    // TODO: check if this still works (has path information).
    webviewOptions.setOptions({
      preloadURL: `file://${__dirname}/webviewPreload.js`,
      nodeIntegration: false,
      enableWhiteListOnly: true,
    });


    // on("ready") is too late to set up at this point.
    // whenReady will resolve right away if the application is already ready.
    await electron.app.whenReady();
    await this.onReady().catch(reportErrorAndStop);
    if (docOpen.path === undefined) {
      this.showWelcome();
    } else {
      this.openFile(docOpen.path);
    }
  }

  private getUrl(docID?: string) {
    const url = new URL(this.appHost);
    if (docID) {
      url.pathname = "doc/" + encodeURIComponent(docID);
    }
    if (this.authMode !== "none") {
      url.searchParams.set("electron_key", this.credential);
    }
    return url.href;
  }

  private createWindow() {
    const win = new electron.BrowserWindow({
      width: 1024,
      height: 768,
      webPreferences: {
        nodeIntegration: false,
        // TODO: check if this still works (has path information).
        preload: path.join(__dirname, "preload.js"),
        webviewTag: true
      },
      backgroundColor: "#42494B",
      autoHideMenuBar: false,
    });

    // Register for title updates
    win.on("page-title-updated", async (event, title) => {
      event.preventDefault();
      win.setTitle(title);
      return;

      // Set represented filename (on macOS) to home directory if on Start page
      if (title === "Home - Grist") {
        const docPath = electron.app.getPath("documents");
        win.setTitle(path.basename(docPath));
        win.setRepresentedFilename(docPath);
      } else {
        let docPath = path.resolve(electron.app.getPath("documents"), title);
        docPath += (path.extname(docPath) === ".grist" ? "" : ".grist");

        try {
          await fse.access(docPath, fse.constants.F_OK);
          // If valid path, set to path
          win.setTitle(path.basename(docPath) + " (" + path.dirname(docPath) + ")");
          win.setRepresentedFilename(docPath);
        } catch(err) {
          // If not valid path, leave title as-is and don"t set the represented file
          win.setTitle(title);
          win.setRepresentedFilename("");
        }
      }
    });

    // If browser JS called window.open(), open it in an external browser if it"s a non-local URL.
    win.webContents.setWindowOpenHandler((details) => {
      if (!gutil.startsWith(details.url, this.appHost)) {
        electron.shell.openExternal(details.url);
        return {action: "deny"};
      }
      return {action: "allow"};
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
      path.join(electron.app.getPath("home"), "grist_debug.log"));

    if (process.env.GRIST_LOG_PATH || fse.existsSync(debugLogPath)) {
      const output = fse.createWriteStream(debugLogPath, { flags: "a" });
      output.on("error", (err) => log.error("Failed to open %s: %s", debugLogPath, err));
      output.on("open", () => {
        log.info("Logging also to %s", debugLogPath);
        output.write("\n--- log starting by pid " + process.pid + " ---\n");

        const fileTransportOptions = {
          name: "debugLog",
          stream: output,
          level: "debug",
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

  public async createDocument(): Promise<NewDocument|null> {
    const result = await electron.dialog.showSaveDialog({
      title: "Create a new Grist document",
      buttonLabel: "Create",
      filters: [GRIST_DOCUMENT_FILTER],
    });
    if (result.canceled) {
      return null;
    }
    let docPath = result.filePath;
    let fileExists = true;
    try {
      await fse.access(docPath, fse.constants.F_OK);
    } catch {
      fileExists = false;
    }
    if (fileExists) {
      electron.dialog.showErrorBox("Cannot create document", `Document ${docPath} already exists.`);
      return null;
    }
    if (!docPath.endsWith(".grist")) {
      docPath += ".grist";
    }
    const docId = await this.docRegistry.registerDoc(docPath);
    return {
      "id": docId,
      "path": docPath
    };
  }

  public async createAndOpenDocument(): Promise<void> {
    const doc = await this.createDocument();
    if (doc) {
      this.openGristDocument(doc.path);
    }
  }

  private async onReady() {

    await updateDb();

    const port = parseInt(process.env["GRIST_PORT"] as string, 10);
    const mergedServer = await MergedServer.create(
      port,
      ["home", "docs", "static", "app"],
      {
        loginSystem: getMinimalElectronLoginSystem.bind(null, this.credential, this.authMode)
      });
    this.flexServer = mergedServer.flexServer;
    this.docRegistry = await DocRegistry.create(this.flexServer.getHomeDBManager());
    await mergedServer.run();
    const serverMethods = this.flexServer.electronServerMethods;

    const recentItems = new RecentItems({
      maxCount: 10,
      intialItems: (await serverMethods.getUserConfig()).recentItems
    });
    const appMenu = new AppMenu(recentItems);
    electron.Menu.setApplicationMenu(appMenu.getMenu());
    const updateManager = new UpdateManager(appMenu);
    console.log(updateManager ? "updateManager loadable, but not used yet" : "");

    // TODO: file new still does something, but it doesn"t make a lot of sense.
    appMenu.on("menu-file-new", this.createAndOpenDocument.bind(this));

    appMenu.on("menu-file-open", async () => {
      const result = await electron.dialog.showOpenDialog({
        title: "Open existing Grist file",
        defaultPath: electron.app.getPath("documents"),
        filters: [GRIST_DOCUMENT_FILTER],
        // disabling extensions "csv", "xlsx", and "xlsm" for the moment.
        properties: ["openFile"]
      });
      if (!result.canceled) {
        await this.openGristDocument(result.filePaths[0]);
      }
    });

    // If we get a request to show the Open-File dialog, do so, and load the result file if one
    // is selected.
    electron.ipcMain.on("show-open-dialog", async () => {
      const result = await electron.dialog.showOpenDialog({
        title: "Open existing Grist file",
        defaultPath: electron.app.getPath("documents"),
        filters: [{ name: "Grist files", extensions: ["grist"] }],
        properties: ["openFile"]
      });
      const files = result.filePaths;
      if (files) {
        this.openGristDocument(files[0]);
      }
    });

    serverMethods.onDocOpen((filePath: string) => {
      // Add to list of recent docs in the dock (mac) or the JumpList (win)
      electron.app.addRecentDocument(filePath);
      // Add to list of recent docs in the menu
      recentItems.addItem(filePath);
      serverMethods.updateUserConfig({ recentItems: recentItems.listItems() });
      // TODO: Electron does not yet support updating the menu except by reassigning the entire
      // menu.  There are proposals to allow menu templates include callbacks that
      // are called on menu open.  https://github.com/electron/electron/issues/528
      appMenu.rebuildMenu();
      electron.Menu.setApplicationMenu(appMenu.getMenu());
    });

    // Now that we are ready, future "open-file" events should just open windows directly.
    electron.app.removeAllListeners("open-file");
    electron.app.on("open-file", (e, filepath) => {
      e.preventDefault();
      this.openFile(filepath);
    });

    electron.app.on("will-quit", function(event) {
      event.preventDefault();
      shutdown.exit(0);
    });

    // Quit when all windows are closed.
    electron.app.on("window-all-closed", () => {
      electron.app.quit();
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

}

function reportErrorAndStop(e: Error) {
  console.error(e);
  process.exit(1);
}
