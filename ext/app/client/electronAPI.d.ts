import { App } from "app/client/ui/App";

export type NewDocument = {
  path: string,
  id: string
}

export type OnImportStart = (name: string, size: number) => void;
export type OnImportEnd = (errMessage?: string) => void;

/**
 * Allows the Grist client to call into electron.
 * See https://www.electronjs.org/docs/latest/tutorial/ipc
 */
interface IElectronAPI {

  // The Grist client can use these interfaces to request the electron main process to perform
  // certain tasks.
  createDoc: () => Promise<NewDocument | null>,
  importDoc: () => Promise<NewDocument | null>,
  registerImportListeners: (callbacks: { onStart: OnImportStart, onEnd: OnImportEnd }) => { cleanup: () => void };
}

declare global {
  interface Window {
    electronAPI: IElectronAPI,
    gristApp: App,
  }
}
