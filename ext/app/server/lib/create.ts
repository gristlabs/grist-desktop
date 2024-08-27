import {getElectronLoginSystem} from "app/electron/LoginSystem";
import {
  HostedDocStorageManagerCreator,
  ICreate,
  makeSimpleCreator
} from "app/server/lib/ICreate";
import {DesktopDocStorageManager} from "app/server/lib/DesktopDocStorageManager";
import {GristApp} from "ext/app/electron/GristApp";

const createDesktopStorageManager: HostedDocStorageManagerCreator =
    (...args) => new DesktopDocStorageManager(GristApp.instance.docRegistry, ...args);

export const create: ICreate = makeSimpleCreator({
  deploymentType: "electron",
  sessionSecret: "something",
  getLoginSystem: getElectronLoginSystem,
  createHostedDocStorageManager: createDesktopStorageManager,
});

export function getCreator(): ICreate {
  return create;
}

