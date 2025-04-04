import * as electron from "electron";
import * as path from "path";
import { GristLoadConfig, decodeUrl } from "app/common/gristUrls";
import { BrowserWindow } from "electron";
import { ElectronLoginSystem } from "./LoginSystem";
import { loadCustomCss } from "./fileUtils";
import * as log from "app/server/lib/log";

export class WindowManager {

  // null represents "not associated with a document".
  private docIdToWindowMap: Map<string, BrowserWindow> = new Map();
  private windowToDocIdMap: Map<BrowserWindow, string | null> = new Map();

  constructor(
    private gristConfig: GristLoadConfig,
    private resolveDocId: (urlIdOrDocId: string) => Promise<string>
  ) {}

  protected _setWindowDocIdMapping(window: BrowserWindow, docId: string | null) {
    this._clearWindowCurrentDocIdMapping(window);
    this.windowToDocIdMap.set(window, docId);
    if (docId) {
      this.docIdToWindowMap.set(docId, window);
    }
  }

  protected _removeWindowMapping(window: BrowserWindow) {
    this._clearWindowCurrentDocIdMapping(window);
    this.windowToDocIdMap.delete(window);
  }

  protected _clearWindowCurrentDocIdMapping(window: BrowserWindow) {
    const currentDocId = this.windowToDocIdMap.get(window);
    if (currentDocId) {
      const currentDocWindow = this.docIdToWindowMap.get(currentDocId);
      // This check is probably unnecessary, but it might prevent other bugs if either of the two caches end up invalid.
      if (currentDocWindow === window) {
        this.docIdToWindowMap.delete(currentDocId);
      }
    }
    this.windowToDocIdMap.set(window, null);
  }

  public get(docId: string): BrowserWindow | null {
    return this.docIdToWindowMap.get(docId) ?? null;
  }

  public add(docId: string | null): BrowserWindow {

    if (docId) {
      const win = this.docIdToWindowMap.get(docId);
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

    this._setWindowDocIdMapping(win, docId);

    win.webContents.on("did-navigate", async (_, url) => {
      const gristUrl = decodeUrl(this.gristConfig, new URL(url));
      // Most of the time gristUrl.doc would be a doc ID, but it could also be an URL ID.
      // Since we're navigating to the doc, we can resolve its ID as we must already know about the doc.
      const newDocId = gristUrl.doc ? await this.resolveDocId(gristUrl.doc) : null;

      this._setWindowDocIdMapping(win, newDocId);
    });

    // "closed" means the window reference is already gone.
    win.on("close", () => {
      this._removeWindowMapping(win);
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

    // Load custom CSS after the window is loaded
    win.webContents.on("did-finish-load", async () => {
      const customCss = await loadCustomCss();
      if (customCss) {
        const { cssContent, cssPath } = customCss;
        try {
          // Inject the CSS into the page
          await win.webContents.executeJavaScript(`
            (function() {
              const style = document.createElement('style');
              style.id = 'grist-custom-user-css';
              style.textContent = \`${cssContent.replace(/`/g, '\\`')}\`; // Escape backticks in CSS
              document.head.appendChild(style);
              
              // Store CSS path in window for status display
              window.gristCustomCssPath = "${cssPath.replace(/\\/g, '\\\\')}"; // Escape backslashes for Windows paths
              console.log("Loaded custom CSS from " + window.gristCustomCssPath);
            })();
          `);
          log.debug(`Injected custom CSS from ${cssPath} into window`);
        } catch (err) {
          log.warn(`Failed to inject custom CSS: ${err}`);
        }
      }
    });

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
