import { contextBridge, ipcRenderer } from 'electron';

// Use electron's context bridge to expose a limited API to the renderer process (which runs app/client).
// Only expose what is necessary. See https://www.electronjs.org/docs/latest/tutorial/context-isolation
// If anything gets added to electronAPI, app/client/electronAPI.d.ts needs to be updated with the typing.
contextBridge.exposeInMainWorld("electronAPI", {
  createDoc: () => ipcRenderer.invoke("create-document"),
  importDoc: (uploadId: number) => ipcRenderer.invoke("import-document", uploadId),
  onMainProcessImportDoc: (callback: (fileContents: Buffer, fileName: string) => void) => {
    ipcRenderer.on("import-document",
      (_event, fileContents: Buffer, fileName: string) => callback(fileContents, fileName));
    return;
  },
});

process.once('loaded', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).isRunningUnderElectron = true;
});
