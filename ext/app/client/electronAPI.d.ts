export type NewDocument = {
  path: string,
  id: string
}

interface IElectronAPI {
  createDoc: () => Promise<NewDocument>,
}

declare global {
  interface Window {
    electronAPI: IElectronAPI
  }
}
