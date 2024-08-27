import {DocRegistry} from "app/electron/DocRegistry";
import {HostedStorageManager, HostedStorageOptions} from "app/server/lib/HostedStorageManager";
import {IDocWorkerMap} from "app/server/lib/DocWorkerMap";
import {ExternalStorageCreator} from "app/server/lib/ExternalStorage";
import log from "grist-core/_build/app/server/lib/log";
import {IDocStorageManager} from "grist-core/_build/app/server/lib/IDocStorageManager";
import { HomeDBManager } from "app/gen-server/lib/homedb/HomeDBManager";
import {fileExists} from "../../electron/fileUtils";

export class DesktopDocStorageManager extends HostedStorageManager {
    // Document paths on disk are stored in the HomeDB. However, they need caching here to allow synchronous access,
    // as Grist Core expects IDocStorageManager to provide file paths synchronously, and it would be a huge effort
    // to refactor.
    private _idToPathMap: Map<string, string> = new Map();
    private _pathToIdMap: Map<string, string> = new Map();

    constructor(
        private _docRegistry: DocRegistry,
        docsRoot: string,
        docWorkerId: string,
        disableS3: boolean,
        docWorkerMap: IDocWorkerMap,
        dbManager: HomeDBManager,
        createExternalStorage: ExternalStorageCreator,
        options?: HostedStorageOptions
    ) {
        super(docsRoot, docWorkerId, disableS3, docWorkerMap, dbManager, createExternalStorage, options);
    }

    getPath(docName: string): string {
        const docPath = this._docRegistry.lookupById(docName);
        log.debug(`getPath ${docName} => ${docPath}`);
        // Fall back on default path if DocRegistry cache is out of sync.
        return docPath || super.getPath(docName);
    }

    async loadFilePathsFromHomeDB(homeDb: HomeDBManager) {
        for (const doc of await homeDb.getAllDocs()) {
          // All Grist Desktop documents are supposed to have externalId set to their file path.
          const docPath = doc.options?.externalId;
          if (docPath && fileExists(docPath)) {
              this.registerDoc(doc.id, docPath);
          }
        }
    };

    async listDocsWithoutFilesOnDisk(homeDb: HomeDBManager): Promise<Document[]> {
        const allDocs = await homeDb.getAllDocs();
        return allDocs.filter((doc) => this.getPath())

    };

    registerDoc(docId: string, docPath: string) {
        this._idToPathMap.set(docId, docPath);
        this._pathToIdMap.set(docPath, docId);
    };

    deregisterDocById(docId: string) {
        const docPath = this._idToPathMap.get(docId);
        if (!docPath) { return; }

        this._idToPathMap.delete(docId);
        this._pathToIdMap.delete(docPath);
    }

    deregisterDocByPath(docPath: string) {
        const docId = this._pathToIdMap.get(docPath);
        if (!docId) {
            return;
        }

        this._idToPathMap.delete(docId);
        this._pathToIdMap.delete(docPath);
    }

    public lookupById(docId: string): string | null {
        return this._idToPathMap.get(docId) ?? null;
    }

    public lookupByPath(docPath: string): string | null {
        return this._pathToIdMap.get(docPath) ?? null;
    }
}

export function isDesktopStorageManager(storageManager: IDocStorageManager): storageManager is DesktopDocStorageManager {
    return storageManager instanceof DesktopDocStorageManager;
}