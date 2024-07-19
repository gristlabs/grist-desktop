import * as electron from "electron";
import * as fse from "fs-extra";
import * as log from "app/server/lib/log";
import * as path from "path";
import * as shutdown from "app/server/lib/shutdown";
import * as winston from "winston";
import AppMenu from "app/electron/AppMenu";
import { DocRegistry } from "./DocRegistry";
import { FlexServer } from "app/server/lib/FlexServer";
import { MergedServer } from "app/server/MergedServer";
import { NewDocument } from "app/client/electronAPI";
import RecentItems from "app/common/RecentItems";
import { UpdateManager } from "app/electron/UpdateManager";
import { WindowManager } from "app/electron/WindowManager";
import { updateDb } from "app/server/lib/dbUtils";
import webviewOptions from "app/electron/webviewOptions";
import { Document } from "app/gen-server/entity/Document";
import { fileExists } from "./utils";

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

export class GristApp {

  private static _instance: GristApp; // The singleton instance.

  // This is referenced by create.ts.
  // TODO: Should we make DocRegistry its own singleton class?
  public docRegistry: DocRegistry;
  private flexServer: FlexServer;
  private windowManager: WindowManager;

  private constructor() {
    this.setupLogging();
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
  private async openGristDocument(docPath: string, win?: electron.BrowserWindow) {
    log.debug(`Opening Grist document ${docPath}`);
    // Do we know about this document?
    let docId = this.docRegistry.lookupByPath(docPath);
    if (docId === null) {
      docId = await this.docRegistry.registerDoc(docPath);
      log.warn(`Document not found in home DB, assigned docId ${docId}`);
    } else {
      log.debug(`Got docId ${docId}`);
    }
    (win || this.windowManager.getOrAdd(docId)).show();
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

    await updateDb();
    const port = parseInt(process.env["GRIST_PORT"] as string, 10);
    const mergedServer = await MergedServer.create(port, ["home", "docs", "static", "app"]);
    this.flexServer = mergedServer.flexServer;
    this.docRegistry = await DocRegistry.create(this.flexServer.getHomeDBManager());
    // TODO: Move the Doc ID lookup function somewhere else.
    this.windowManager = new WindowManager(this.flexServer.getGristConfig(), async (docIdOrUrlId) => {
      if (this.docRegistry.lookupById(docIdOrUrlId) === null) {
        // DocRegistry does not know about this doc ID, so this must be an URL ID.
        return (await this.flexServer.getHomeDBManager().connection.createQueryBuilder()
          .select("docs")
          .from(Document, "docs")
          .where('docs.url_id = :urlId', {urlId: docIdOrUrlId})
          .getRawAndEntities()).entities[0].id;
      }
      // Otherwise it is a doc ID already. Return as-is.
      return docIdOrUrlId;
    });

    // Wait for both electron and the Grist server to fully initialize.
    await Promise.all([mergedServer.run(), electron.app.whenReady()]);

    const serverMethods = this.flexServer.electronServerMethods;

    const recentItems = new RecentItems({
      maxCount: 10,
      intialItems: (await serverMethods.getUserConfig()).recentItems
    });
    const appMenu = new AppMenu(recentItems);
    electron.Menu.setApplicationMenu(appMenu.getMenu());
    const updateManager = new UpdateManager(appMenu);
    console.log(updateManager ? "updateManager loadable, but not used yet" : "");

    appMenu.on("menu-file-new", async (win: electron.BrowserWindow) => {
      const doc = await this.createDocument();
      if (doc) {
        win.loadURL(this.windowManager.getUrl(doc.id));
      }
    });

    // The "Create Empty Document" button sends this event via the electron context bridge.
    electron.ipcMain.handle("create-document", this.createDocument.bind(this));

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

    // Shut down the Grist server gracefully when the application is closed.
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

    if (docOpen.path === undefined) {
      this.windowManager.getOrAdd(null);
    } else {
      this.openFile(docOpen.path);
    }
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

  /**
   * Show a dialog asking the user for a location, and create a new Grist document there.
   * The document is added to the home DB, but not actually created in the filesystem until opened.
   */
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
    if (fileExists(docPath)) {
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

  private reportError(e: Error) {
    electron.dialog.showMessageBoxSync({
      type: "info",
      buttons: ["Ok"],
      message: "Error",
      detail: String(e)
    });
  }

}

