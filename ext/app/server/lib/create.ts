import { ICreate, makeSimpleCreator } from "app/server/lib/ICreate";
import { GristApp } from "ext/app/electron/GristApp";
import { IDocStorageManager } from "app/server/lib/IDocStorageManager";
import log from "app/server/lib/log";

export const create: ICreate = makeSimpleCreator({
  deploymentType: "electron",
  sessionSecret: "something",
  decorateDocStorageManager: (manager: IDocStorageManager) => {
    const docRegistry = GristApp.instance.docRegistry;
    manager.getPath = (docId: string) => {
      log.debug(`getPath ${docId} => ${docRegistry.lookupById(docId)}`);
      return docRegistry.lookupById(docId) as string; // TODO: consider possible errors
    };
  },
});

export function getCreator(): ICreate {
  return create;
}
