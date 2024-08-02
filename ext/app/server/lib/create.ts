import { ICreate, makeSimpleCreator } from "app/server/lib/ICreate";
import { GristApp } from "app/electron/GristApp";
import { IDocStorageManager } from "app/server/lib/IDocStorageManager";
import { getElectronLoginSystem } from "app/electron/LoginSystem";
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
  getLoginSystem: getElectronLoginSystem,
});

export function getCreator(): ICreate {
  return create;
}
