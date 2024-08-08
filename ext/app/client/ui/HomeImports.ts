import { AppModel, reportError } from 'app/client/models/AppModel';
import { IMPORTABLE_EXTENSIONS } from 'app/client/lib/uploads';
import { ImportProgress } from 'app/client/ui/ImportProgress';
import { byteString } from 'app/common/gutil';
import { openFilePicker } from 'app/client/ui/FileDialog';
import { uploadFiles } from 'app/client/lib/uploads';

/**
 * Imports a document and returns its upload ID, or null if no files were selected.
 */
async function docImport(app: AppModel, fileToImport?: File): Promise<number|null> {
  let files: File[];

  if (fileToImport === undefined) {
    files = await openFilePicker({
      multiple: false,
      accept: IMPORTABLE_EXTENSIONS.filter((extension) => extension !== ".grist").join(","),
    });
    if (!files.length) { return null; }
  } else {
    files = [fileToImport];
  }

  const progressUI = app.notifier.createProgressIndicator(files[0].name, byteString(files[0].size));
  const progress = ImportProgress.create(progressUI, progressUI, files[0]);
  try {
    const docWorker = await app.api.getWorkerAPI('import');
    const uploadResult = await uploadFiles(files, {docWorkerUrl: docWorker.url, sizeLimit: 'import'},
      (p) => progress.setUploadProgress(p));

    return uploadResult!.uploadId;
  } catch (err) {
    reportError(err);
    return null;
  } finally {
    progress.finish();
    progressUI.dispose();
  }
}

export const homeImports = {docImport};
