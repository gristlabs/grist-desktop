import * as electron from "electron";
import * as log from "app/server/lib/log";
import * as path from "path";
import * as shutdown from "app/server/lib/shutdown";
import { fileCreatable, fileExists } from "app/electron/utils";
import { ActiveDoc } from "app/server/lib/ActiveDoc";
import AppMenu from "app/electron/AppMenu";
import { DocRegistry } from "./DocRegistry";
import { Document } from "app/gen-server/entity/Document";
import { FlexServer } from "app/server/lib/FlexServer";
import { IMPORTABLE_EXTENSIONS } from "app/client/lib/uploads";
import { MergedServer } from "app/server/MergedServer";
import { NewDocument } from "app/client/electronAPI";
import { OptDocSession } from "app/server/lib/DocSession";
import RecentItems from "app/common/RecentItems";
import { UpdateManager } from "app/electron/UpdateManager";
import { WindowManager } from "app/electron/WindowManager";
import { globalUploadSet } from "app/server/lib/uploads";
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

export class GristApp {

  private static _instance: GristApp; // The singleton instance.

  // This is referenced by create.ts.
  // TODO: Should we make DocRegistry its own singleton class? (To avoid circular import.)
  public docRegistry: DocRegistry;
  private flexServer: FlexServer;
  private windowManager: WindowManager;

  private constructor() {}

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
   * Opens the file at filepath. File can be a Grist document, or an importable document.
   * Import has not been implemented yet, and will just throw an error for now.
   */
  public async openFile(filepath: string) {
    log.debug(`Opening file ${filepath}`);
    const ext = path.extname(filepath);
    if (ext === ".grist") {
      await this.openGristDocument(filepath);
    } else if (IMPORTABLE_EXTENSIONS.includes(ext)) {
      throw new Error("Import has not been implemented");
    } else {
      throw new Error(`Unsupported format ${ext}`);
    }
  }

  public async run(docOpen: FileToOpen) {

    electron.app.on("second-instance", (_e, _argv, _cwd, _additionalData) => {
      const instanceHandoverInfo = _additionalData as InstanceHandoverInfo;
      this.openFile(instanceHandoverInfo["fileToOpen"])
        .catch((e: Error) => electron.dialog.showErrorBox("Cannot open file", e.message));
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

    // The following events are sent through the electron context bridge.
    // "Create Empty Document".
    electron.ipcMain.handle("create-document", (_event) => this.createDocument());
    // "Import Document", after dealing with file upload.
    electron.ipcMain.handle("import-document", (_event, importUploadId) => this.createDocument(importUploadId));

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
      this.openFile(filepath)
        .catch((e: Error) => electron.dialog.showErrorBox("Cannot open file", e.message));
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
      try {
        await this.openFile(docOpen.path);
      } catch(e) {
        this.windowManager.getOrAdd(null);
        electron.dialog.showErrorBox("Cannot open file", (e as Error).message);
      }
    }
  }

  private async askNewGristDocPath(): Promise<string|null> {
    const result = await electron.dialog.showSaveDialog({
      title: "Save new Grist document",
      buttonLabel: "Save",
      filters: [GRIST_DOCUMENT_FILTER],
    });
    if (result.canceled) {
      return null;
    }
    const docPath = result.filePath.endsWith(".grist")
      ? result.filePath
      : result.filePath + ".grist";
    if (fileExists(docPath)) {
      electron.dialog.showErrorBox("Cannot create document", `Document ${docPath} already exists.`);
      return null;
    }
    if (!fileCreatable(docPath)) {
      electron.dialog.showErrorBox("Cannot create document", `Selected location ${docPath} is not writable.`);
      return null;
    }
    return docPath;
  }

  /**
   * Show a dialog asking the user for a location, and create a new Grist document there.
   * The document is added to the home DB, but not actually created in the filesystem until opened.
   * If importUploadId is specified, import data from the uploaded file associated with such ID. This implements the
   * home page import functionality of grist-core.
   *
   * TODO: Investigate ways to map the source file into the sandbox without "uploading" it.
   * The actual import is done by the data engine, which runs in a sandbox by default, hence cannot access arbitrary
   * files on the host filesystem.
   * It is suboptimal to have to "upload" the file first, but this reuses grist-core's infrastructure to help us avoid
   * dealing with various sandbox flavors individually.
   */
  public async createDocument(importUploadId?: number): Promise<NewDocument|null> {
    const docPath = await this.askNewGristDocPath();
    if (!docPath) {
      return null;
    }
    const docId = await this.docRegistry.registerDoc(docPath);

    if (importUploadId !== undefined) {
      // TODO: Move getDefaultUser out of DocRegistry.
      const accessId = this.flexServer.getDocManager().makeAccessId((await this.docRegistry.getDefaultUser()).id);
      const uploadInfo = globalUploadSet.getUploadInfo(importUploadId, accessId);
      const activeDoc = new ActiveDoc(this.flexServer.getDocManager(), docId);
      // Wait for the docPluginManager to fully initialize. If we don't do this, its _tmpDir will possibly be undefined,
      // leading to an error when grist-core later moves the uploaded file.
      await activeDoc.docPluginManager!.ready;
      // Fake a session required by the server. "system" mode gives us the owner role on the new document.
      const fakeDocSession: OptDocSession = {client: null, mode: "system"};
      await activeDoc.loadDoc(fakeDocSession, {forceNew: true, skipInitialTable: true});
      // This uses the same oneStepImport function that grist-core DocManager's _doImport invokes.
      // TODO: Show a loading UI when the import is in progress.
      // The import process could take several seconds for a small csv file, or longer for larger files.
      await activeDoc.oneStepImport(fakeDocSession, uploadInfo);
    }

    return {
      id: docId,
      path: docPath
    };
  }

}
