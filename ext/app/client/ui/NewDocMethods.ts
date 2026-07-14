import { HomeModel } from "app/client/models/HomeModel";
import { IProgress } from "app/client/models/NotifyModel";
import { ImportProgress } from "app/client/ui/ImportProgress";
import { byteString } from "app/common/gutil";
import { electronOnly } from "app/client/electronOnly";
import { reportError } from "app/client/models/errors";

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
  const app = home.app;
  let progress: ImportProgress | undefined;
  let progressUI: IProgress | undefined;
  const { cleanup: cleanupImportListeners } = window.electronAPI.registerImportListeners({
    onStart: (name: string, size: number) => {
      progressUI = app.notifier.createProgressIndicator(name, byteString(size));
      // Cast is unfortunate - ImportProgress expects a File object, but only needs name and size.
      progress = ImportProgress.create(progressUI, progressUI, { name, size } as File);
      // File is already "uploaded". We just want the estimated import time.
      progress.setUploadProgress(100);
    },
    onEnd: (errMessage) => {
      if (errMessage) {
        reportError(new Error(errMessage));
      }
      progress?.finish();
      progressUI?.dispose();
    },
  });

  try {
    const doc = await window.electronAPI.importDoc();

    if (doc) {
      window.location.assign("/o/docs/" + doc.id);
    }
  } catch (err) {
    reportError(err);
  } finally {
    cleanupImportListeners();
  }
}

// There _should_ also be an "importFromPluginAndOpen" here, but Grist Desktop will not have import
// plugins, so it is left out.
export const newDocMethods = { createDocAndOpen, importDocAndOpen };
