import { IpcRendererEvent, contextBridge, ipcRenderer } from 'electron';
import { OnImportEnd, OnImportStart } from "app/client/electronAPI";

type ElectronListener = (event: IpcRendererEvent, ...args: any[]) => void

// Use electron's context bridge to expose a limited API to the renderer process (which runs app/client).
// Only expose what is necessary. See https://www.electronjs.org/docs/latest/tutorial/context-isolation
// If anything gets added to electronAPI, app/client/electronAPI.d.ts needs to be updated with the typing.
// Make sure `event` isn't passed to the callbacks - it exposes ipcRenderer via event.sender, which is a security issue.
contextBridge.exposeInMainWorld("electronAPI", {
  createDoc: () => ipcRenderer.invoke("create-document"),
  importDoc: () => ipcRenderer.invoke("import-document"),
  registerImportListeners: ({ onStart, onEnd }: { onStart: OnImportStart, onEnd: OnImportEnd }) => {
    let cleanedUp = false;
    const startListener: ElectronListener = (_event, ...args: Parameters<OnImportStart>) => { onStart(...args); };
    const endListener = (_event?: IpcRendererEvent, ...args: Parameters<OnImportEnd>) => {
      if (cleanedUp) { return; }
      cleanedUp = true;
      ipcRenderer.off("import-started", startListener);
      ipcRenderer.off("import-ended", endListener);
      onEnd(...args);
    };
    ipcRenderer.on("import-started", startListener);
    ipcRenderer.on("import-ended", endListener);
    // Allow the caller to terminate this in the worst case. Covers any situation where import-ended doesn't fire.
    return { cleanup: () => endListener() };
  },
});

process.once('loaded', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).isRunningUnderElectron = true;
});
