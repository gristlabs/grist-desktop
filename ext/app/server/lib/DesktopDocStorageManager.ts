import {DocRegistry} from "app/electron/DocRegistry";
import log from "app/server/lib/log";
import {HostedStorageManager, HostedStorageOptions} from "app/server/lib/HostedStorageManager";
import {IDocWorkerMap} from "app/server/lib/DocWorkerMap";
import {ExternalStorageCreator} from "app/server/lib/ExternalStorage";
import { HomeDBManager } from "app/gen-server/lib/homedb/HomeDBManager";

export class DesktopDocStorageManager extends HostedStorageManager {
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
}
