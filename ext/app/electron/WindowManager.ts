import * as electron from "electron";
import * as path from "path";
import { GristLoadConfig, decodeUrl } from "app/common/gristUrls";
import { BrowserWindow } from "electron";
import { ElectronLoginSystem } from "./LoginSystem";

export class WindowManager {

  // null represents "not associated with a document".
  private docToWindowMap: Map<string, BrowserWindow> = new Map();
  private windowToDocMap: Map<BrowserWindow, string | null> = new Map();

  constructor(
    private gristConfig: GristLoadConfig,
    private resolveDocId: (urlIdOrDocId: string) => Promise<string>
  ) {}

  public get(docId: string): BrowserWindow | null {
    return this.docToWindowMap.get(docId) ?? null;
  }

  public add(docId: string | null): BrowserWindow {

    if (docId) {
      const win = this.docToWindowMap.get(docId);
      if (win) {
        return win;
      }
    }

    const win = new BrowserWindow({
      width: 1024,
      height: 768,
      webPreferences: {
        nodeIntegration: false,
        preload: path.join(__dirname, "preload.js"),
        webviewTag: true
      },
      backgroundColor: "#42494B",
      autoHideMenuBar: false,
    });

    if (docId) {
      this.docToWindowMap.set(docId, win);
    }
    this.windowToDocMap.set(win, docId);

    win.webContents.on("did-navigate", async (_, url) => {
      const gristUrl = decodeUrl(this.gristConfig, new URL(url));
      const oldDocId = this.windowToDocMap.get(win);
      // Most of the time this would be a doc ID, but it could also be an URL ID.
      const newDocIdOrUrlId = gristUrl.doc ?? null;
      // oldDocId must exist because windowToDocMap knows about all existing windows.
      this.docToWindowMap.delete(oldDocId!);
      if (newDocIdOrUrlId) {
        // If we are navigating to a document, we must already know about it. Otherwise the document would
        // not even have a doc ID in the first place.
        const newDocId = await this.resolveDocId(newDocIdOrUrlId);
        this.docToWindowMap.set(newDocId, win);
        this.windowToDocMap.set(win, newDocId);
      } else {
        this.windowToDocMap.set(win, null);
      }
    });

    // "closed" means the window reference is already gone.
    win.on("close", () => {
      const oldDoc = this.windowToDocMap.get(win!);
      this.docToWindowMap.delete(oldDoc!);
      this.windowToDocMap.delete(win!);
    });

    // If browser JS called window.open(), open it in an external browser if it"s a non-local URL.
    win.webContents.setWindowOpenHandler((details) => {
      if (!details.url.startsWith(this.gristConfig.homeUrl!)) {
        electron.shell.openExternal(details.url);
        return {action: "deny"};
      }
      return {action: "allow"};
    });

    win.loadURL(this.getUrl(docId));

    return win;
  }

  public getUrl(docID?: string | null) {
    const url = new URL(this.gristConfig.homeUrl!);
    if (docID) {
      url.pathname = "doc/" + encodeURIComponent(docID);
    }
    return ElectronLoginSystem.instance.authenticateURL(url).href;
  }

}
