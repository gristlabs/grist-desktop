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

export async function importDocAndOpen(home: HomeModel) {
  electronOnly();
  const destWS = home.newDocWorkspace.get();
  if (!destWS || destWS === "unsaved") { return; }
  const uploadId = await docImport(home.app);
  if (uploadId === null) { return; }
  const doc = await window.electronAPI.importDoc(uploadId);
  if (doc) {
    window.location.assign("/o/docs/" + doc.id);
  }
}

export async function importFromPluginAndOpen() {
  alert("not implemented");
}
