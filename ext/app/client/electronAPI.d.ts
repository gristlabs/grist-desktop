import { HomeModel } from "app/client/models/HomeModel";

export type NewDocument = {
  path: string,
  id: string
}

/**
 * Allows the Grist client to call into electron.
 * See https://www.electronjs.org/docs/latest/tutorial/ipc
 */
interface IElectronAPI {

  // The Grist client can use these interfaces to request the electron main process to perform
  // certain tasks.
  createDoc: () => Promise<NewDocument>,
  importDoc: (uploadId: number) => Promise<NewDocument>,

  // The Grist client needs to call these interfaces to register callback functions for certain
  // events coming from the electron main process.
  onMainProcessImportDoc: (callback: (fileContents: Buffer, fileName: string) => void) => void

}

declare global {
  interface Window {
    electronAPI: IElectronAPI,
    gristHomeModel: HomeModel,
  }
}
