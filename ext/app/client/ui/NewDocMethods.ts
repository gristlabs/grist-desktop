import { HomeModel } from 'app/client/models/HomeModel';
import { electronOnly } from "app/client/electronOnly";
import { homeImports } from 'app/client/ui/HomeImports';
import { urlState } from 'app/client/models/gristUrlState';

async function createDocAndOpen() {
  electronOnly();
  const doc = await window.electronAPI.createDoc();
  if (doc) {
    window.location.assign("/o/docs/" + doc.id);
  }
}

// Invoked by the "Import Document" button.
async function importDocAndOpen(home: HomeModel) {
  electronOnly();
  return _importUploadedFileAndOpen(
      await homeImports.docImport(home.app)
  );
}

// Internal implementation.
async function _importUploadedFileAndOpen(uploadId: number | null) {
  if (uploadId === null) { return; }
  const doc = await window.electronAPI.importDoc(uploadId);
  if (doc) {
    await urlState().pushUrl({doc: doc.id});
  }
}

// Register the callback function for importing from the file menu.
// The ? is for external visitors over the network. electronAPI is set by electron's preload script
// and is undefined for non-electron visitors. An error here will make the entire page fail to load.
window.electronAPI?.onMainProcessImportDoc((fileContents: Buffer, fileName: string) => {
  (async() => {
    while (!window.gristHomeModel || !window.gristHomeModel.app) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const uploadId = await homeImports.fileImport([new File([fileContents], fileName)], window.gristHomeModel.app);
    await _importUploadedFileAndOpen(uploadId);
  })();
});

// There _should_ also be an "importFromPluginAndOpen" here, but Grist Desktop will not have import
// plugins, so it is left out.
export const newDocMethods = { createDocAndOpen, importDocAndOpen };
