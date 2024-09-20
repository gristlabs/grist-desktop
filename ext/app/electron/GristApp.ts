import * as electron from "electron";
import * as fse from "fs-extra";
import * as log from "app/server/lib/log";
import * as path from "path";
import * as shutdown from "app/server/lib/shutdown";
import { fileCreatable, fileExists } from "app/electron/fileUtils";
import { ActiveDoc } from "app/server/lib/ActiveDoc";
import AppMenu from "app/electron/AppMenu";
import { Document } from "app/gen-server/entity/Document";
import { FlexServer } from "app/server/lib/FlexServer";
import { IMPORTABLE_EXTENSIONS } from "app/client/lib/uploads";
import { MergedServer } from "app/server/MergedServer";
import { NewDocument } from "app/client/electronAPI";
import { OptDocSession } from "app/server/lib/DocSession";
import RecentItems from "app/common/RecentItems";
import { UpdateManager } from "app/electron/UpdateManager";
import { WindowManager } from "app/electron/WindowManager";
import { decodeUrl } from "app/common/gristUrls";
import { globalUploadSet } from "app/server/lib/uploads";
import { updateDb } from "app/server/lib/dbUtils";
import webviewOptions from "app/electron/webviewOptions";
import {DesktopDocStorageManager, isDesktopStorageManager} from "app/server/lib/DesktopDocStorageManager";
import {HomeDBManager} from "app/gen-server/lib/homedb/HomeDBManager";
import {getDefaultUser} from "app/electron/userUtils";

const GRIST_DOCUMENT_FILTER = {name: "Grist documents", extensions: ["grist"]};
const IMPORTABLE_DOCUMENT_FILTER = {name: "Importable documents", extensions:
  IMPORTABLE_EXTENSIONS.filter(ext => ext !== ".grist").map(ext => ext.substring(1))};

type InstanceHandoverInfo = {
  fileToOpen: string|null;
}

export class GristApp {

  private static _instance: GristApp; // The singleton instance.

  // This is referenced by create.ts.
  private flexServer: FlexServer;
  private windowManager: WindowManager;

  private constructor() {}

  public static get instance(): GristApp {
    if (!GristApp._instance) {
      GristApp._instance = new GristApp();
    }
    return GristApp._instance;
  }

  public get storageManager(): DesktopDocStorageManager {
    const currentStorageManager = this.flexServer.getStorageManager();
    if (!isDesktopStorageManager(currentStorageManager)) {
      throw new Error("FlexServer running with incorrect storage manager for desktop.");
    }
    return currentStorageManager;
  }

  public get homeDBManager(): HomeDBManager {
    return this.flexServer.getHomeDBManager();
  }

  // TODO: Move this function somewhere else.
  private isWindowShowingDocument(win: Electron.BrowserWindow) {
    const url = new URL(win.webContents.getURL());
    const gristUrl = decodeUrl(this.flexServer.getGristConfig(), url);
    return gristUrl.doc !== undefined;
  }

  public async run(initialFileToOpen: string|null) {

    electron.app.on("second-instance", (_e, _argv, _cwd, _additionalData) => {
      const instanceHandoverInfo = _additionalData as InstanceHandoverInfo;
      if (instanceHandoverInfo.fileToOpen !== null) {
        // If the new instance didn't want to open any file, we don't need to do anything.
        this.openFile(instanceHandoverInfo.fileToOpen)
          .catch((e: Error) => electron.dialog.showErrorBox("Cannot open file", e.message));
      }
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
    this.windowManager = new WindowManager(this.flexServer.getGristConfig(),
      // TODO: Move this Doc ID lookup function somewhere else.
      async (docIdOrUrlId) => {
        if (this.storageManager.lookupById(docIdOrUrlId) === null) {
          // Storage manager does not know about this doc ID, so this must be an URL ID.
          return (await this.flexServer.getHomeDBManager().connection.createQueryBuilder()
            .select("docs")
            .from(Document, "docs")
            .where('docs.url_id = :urlId', {urlId: docIdOrUrlId})
            .getRawAndEntities()).entities[0].id;
        }
        // Otherwise it is a doc ID already. Return as-is.
        return docIdOrUrlId;
      }
    );

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
      const doc = await this.createDocument(win);
      if (doc) {
        win.loadURL(this.windowManager.getUrl(doc.id));
      }
    });
    appMenu.on("menu-file-open", async (win: electron.BrowserWindow) => {
      const result = await electron.dialog.showOpenDialog({
        title: "Open or import",
        defaultPath: electron.app.getPath("documents"),
        filters: [GRIST_DOCUMENT_FILTER, IMPORTABLE_DOCUMENT_FILTER],
        properties: ["openFile"]
      });
      if (!result.canceled) {
        await this.openFile(result.filePaths[0], win);
      }
    });

    // The following events are sent through the electron context bridge.
    // "Create Empty Document".
    electron.ipcMain.handle("create-document", (event) =>
      this.createDocument(electron.BrowserWindow.fromWebContents(event.sender)!));
    // "Import Document", after dealing with file upload.
    electron.ipcMain.handle("import-document", (event, importUploadId) =>
      this.createDocument(electron.BrowserWindow.fromWebContents(event.sender)!, importUploadId));

    serverMethods.onDocOpen((filePath: string) => {
      // Add to list of recent docs in the dock (mac) or the JumpList (win)
      electron.app.addRecentDocument(filePath);
      // Add to list of recent docs in the menu
      recentItems.addItem(filePath);
      serverMethods.updateUserConfig({ recentItems: recentItems.listItems() });
      // TODO: Electron does not yet support updating the menu except by reassigning the entire
      // menu.  There are proposals to allow menu templates include callbacks that
      // are called on menu open. https://github.com/electron/electron/issues/528
      appMenu.rebuildMenu();
      electron.Menu.setApplicationMenu(appMenu.getMenu());
    });

    // Now that we are ready, future "open-file" events should just open windows directly.
    electron.app.removeAllListeners("open-file");
    electron.app.on("open-file", (e, filePath) => {
      e.preventDefault();
      this.openFile(filePath)
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

    if (initialFileToOpen === null) {
      this.windowManager.add(null);
    } else {
      try {
        await this.openFile(initialFileToOpen);
      } catch(e) {
        this.windowManager.add(null);
        electron.dialog.showErrorBox("Cannot open file", (e as Error).message);
      }
    }
  }

  public async getDefaultUser() {
    const user = await getDefaultUser(this.flexServer.getHomeDBManager());
    if (!user) {
      throw new Error('cannot find default user');
    }
    return user;
  }

  /**
   * Show a dialog to ask the user for a location to store a Grist document to be created.
   * If the user does not provide an extension name, ".grist" will be appended.
   * Show an error dialog and abort if the file already exists, or cannot be created.
   *
   * @param initiatorWindow The electron window that requested to create a new document.
   * @returns A string representing the picked location, or null if the user aborted.
   */
  private async askNewGristDocPath(initiatorWindow: electron.BrowserWindow): Promise<string|null> {
    const result = await electron.dialog.showSaveDialog(initiatorWindow, {
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
   * Opens the file at filepath. File can be a Grist document, or an importable document.
   * @param filePath Path to the file to open. Can be relative.
   * @param requestWindow The window associated with the open request. If this window is not showing
   *                      a document already, it will be reused for the newly opened document.
   */
  public async openFile(filePath: string, requestWindow?: electron.BrowserWindow) {

    // Use absolute path only from now on.
    filePath = path.resolve(filePath);
    const ext = path.extname(filePath);

    if (ext === ".grist") {

      log.debug(`Opening Grist document ${filePath}`);
      let docId = this.storageManager.lookupByPath(filePath);
      if (!docId) {
        log.debug(`Opening new document at ${filePath}`);
        docId = await this.registerDoc(filePath);
      } else {
        log.debug(`Opening existing document ${docId} at ${filePath}`);
      }

      const homeDBManager = this.flexServer.getHomeDBManager();

      // It's possible to open the .grist file for a document in trash, which would error.
      // Restore the document instead before opening
      await homeDBManager.undeleteDocument({
        userId: (await this.getDefaultUser()).id,
        urlId: docId,
      });

      const existingWindow = this.windowManager.get(docId);
      if (existingWindow) {
        // If the document is already open in a window, bring that window up to the user.
        existingWindow.show();
      } else if (requestWindow && !this.isWindowShowingDocument(requestWindow)) {
        // If a specific window issued the open request, and it is not currently busy with another
        // document, reuse this window.
        await requestWindow.webContents.loadURL(this.windowManager.getUrl(docId));
      } else {
        // Otherwise we keep open documents open, and create a new window for the opening document.
        this.windowManager.add(docId).show();
      }

    } else if (IMPORTABLE_EXTENSIONS.includes(ext)) {
      // Note: IMPORTABLE_EXTENSIONS comes from grist-core and includes ".grist".

      log.debug(`Importing from file ${filePath}`);
      const fileContents = fse.readFileSync(filePath);

      if (requestWindow && !this.isWindowShowingDocument(requestWindow)) {
        // Reuse an existing window, see above branch.
        // Return to the home page first, since the handler function only exists there.
        await requestWindow.webContents.loadURL(this.windowManager.getUrl());
        // The window is already fully loaded, so we can directly send the signal.
        requestWindow.webContents.send("import-document", fileContents, path.basename(filePath));
      } else {
        const win = this.windowManager.add(null);
        // The window is newly created. We must wait until it is loaded before sending the signal.
        win.webContents.on("did-finish-load", () => {
          win.webContents.send("import-document", fileContents, path.basename(filePath));
        });
        // The signal will be handled by importDocAndOpen, which automatically redirects for us.
      }

    } else {
      // We can only handle Grist documents and importable documents. The file picker filter should
      // prevent us from ending up here, but just in case...
      throw new Error(`Unsupported format ${ext}`);
    }
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
   *
   * @param initiatorWindow The electron window that issued this request.
   * @param importUploadId The upload ID.
   * @returns A promise that resolves to a representation of the saved document, or null if the operation is aborted.
   */
  public async createDocument(initiatorWindow: electron.BrowserWindow, importUploadId?: number): Promise<NewDocument|null> {
    const docPath = await this.askNewGristDocPath(initiatorWindow);
    if (!docPath) {
      return null;
    }
    const docId = await this.registerDoc(docPath);

    if (importUploadId !== undefined) {
      const accessId = this.flexServer.getDocManager().makeAccessId((await this.getDefaultUser()).id);
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

  public async registerDoc(docPath: string): Promise<string> {
    const defaultUser = await this.getDefaultUser();
    const wss = this.homeDBManager.unwrapQueryResult(
      await this.homeDBManager.getOrgWorkspaces({userId: defaultUser.id}, 0)
    );

    for (const doc of wss[0].docs) {
      if (doc.options?.externalId === docPath) {
        // If we're trying to re-register an already registered doc, the storage manager's cache might be invalid.
        // Update the storage manager's cache and try to continue, but log in case we need to later debug this case.
        log.warn(`Attempting to re-register document ${doc.id} at ${docPath}`);
        this.storageManager.registerDocPath(doc.id, docPath);
        return doc.id;
      }
    }

    // Create the entry in the home database.
    const docId = this.homeDBManager.unwrapQueryResult(
      await this.homeDBManager.addDocument(
        {
          userId: defaultUser.id,
        },
        wss[0].id,
        {
          name: path.basename(docPath, '.grist'),
          options: {externalId: docPath},
        }
      )
    );

    // Inform the storage manager where to find the file for that doc.
    this.storageManager.registerDocPath(docId, docPath);
    return docId;
  }
}
