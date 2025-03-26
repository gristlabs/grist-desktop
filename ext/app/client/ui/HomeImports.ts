import { AppModel, reportError } from 'app/client/models/AppModel';
import { EXTENSIONS_IMPORTABLE_AS_DOC } from 'app/client/lib/uploads';
import { ImportProgress } from 'app/client/ui/ImportProgress';
import { byteString } from 'app/common/gutil';
import { openFilePicker } from 'app/client/ui/FileDialog';
import { uploadFiles } from 'app/client/lib/uploads';

/**
 * Imports a document and returns its upload ID, or null if no files were selected.
 */
export async function docImport(app: AppModel): Promise<number|null> {
  // We use openFilePicker() and uploadFiles() separately, rather than the selectFiles() helper,
  // because we only want to connect to a docWorker if there are in fact any files to upload.

  // Start selecting files.  This needs to start synchronously to be seen as a user-initiated
  // popup, or it would get blocked by default in a typical browser.
  const files: File[] = await openFilePicker({
    multiple: false,
    accept: EXTENSIONS_IMPORTABLE_AS_DOC.join(","),
  });

  if (!files.length) { return null; }

  return await fileImport(files, app);
}

/**
 * Imports one or more files and returns its upload ID, or null if no files were selected.
 */

export async function fileImport(
    files: File[], app: AppModel): Promise<number | null> {
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

export const homeImports = {docImport, fileImport};
