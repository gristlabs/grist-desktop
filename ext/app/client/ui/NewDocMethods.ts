import {electronOnly} from "app/client/electronOnly";

export async function createDocAndOpen() {
  electronOnly();
  const doc = await window.electronAPI.createDoc();
  if (doc) {
    window.location.assign("/o/docs/" + doc.id);
  }
}

export async function importDocAndOpen() {
  alert("not implemented");
}

export async function importFromPluginAndOpen() {
  alert("not implemented");
}
