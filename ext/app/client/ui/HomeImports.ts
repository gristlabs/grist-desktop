import { AppModel } from 'app/client/models/AppModel';

/**
 * Imports a document and returns its upload ID, or null if no files were selected.
 */
export async function docImport(_app: AppModel): Promise<number|null> {
  throw new Error(
      "Not implemented - Grist Desktop uses its own import mechanism on the server. " +
      "If you are seeing this message, please report it."
  );
}

/**
 * Imports one or more files and returns its upload ID, or null if no files were selected.
 */

export async function fileImport(
    _files: File[], _app: AppModel): Promise<number | null> {
  throw new Error(
      "Not implemented - Grist Desktop uses its own import mechanism on the server. " +
      "If you are seeing this message, please report it."
  );
}

export const homeImports = {docImport, fileImport};
