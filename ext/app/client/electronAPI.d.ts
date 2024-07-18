type NewDocument = {
  path: string,
  id: string
}

export interface IElectronAPI {
  createDocAndOpen: () => Promise<NewDocument>,
}

declare global {
  interface Window {
    electronAPI: IElectronAPI
  }
}
