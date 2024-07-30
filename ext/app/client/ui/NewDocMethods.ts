import { HomeModel } from 'app/client/models/HomeModel';
import { docImport } from 'app/client/ui/HomeImports';
import { electronOnly } from "app/client/electronOnly";

export async function createDocAndOpen() {
  electronOnly();
  const doc = await window.electronAPI.createDoc();
  if (doc) {
    window.location.assign("/o/docs/" + doc.id);
  }
}

export async function importDocAndOpen(home: HomeModel, fileToImport: File) {
  electronOnly();
  const uploadId = await docImport(home.app, fileToImport);
  if (uploadId === null) { return; }
  const doc = await window.electronAPI.importDoc(uploadId);
  if (doc) {
    window.location.assign("/o/docs/" + doc.id);
  }
}

// The ? is for external visitors over the network. electronAPI is set by electron's preload script
// and is undefined for non-electron visitors. An error here will make the entire page fail to load.
window.electronAPI?.onMainProcessImportDoc((fileContents: Buffer, fileName: string) => {
  (async() => {
    while (!window.gristHomeModel || !window.gristHomeModel.app) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    importDocAndOpen(window.gristHomeModel, new File([fileContents], fileName));
  })();
});

// Called by import plugins.
export async function importFromPluginAndOpen() {
  alert("not implemented");
}
