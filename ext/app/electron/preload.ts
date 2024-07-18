import { contextBridge, ipcRenderer } from 'electron';

// Use electron's context bridge to expose a limited API to the renderer process (which runs app/client).
// Only expose what is necessary. See https://www.electronjs.org/docs/latest/tutorial/context-isolation
// If anything gets added to electronAPI, app/client/electronAPI.d.ts needs to be updated with the typing.
contextBridge.exposeInMainWorld("electronAPI", {
  createDoc: () => ipcRenderer.invoke("create-document"),
});

process.once('loaded', () => {
  // global.electronSelectFiles = remote.getGlobal('electronSelectFiles').bind(null, remote.getCurrentWindow());
  (global as any).isRunningUnderElectron = true;
});
