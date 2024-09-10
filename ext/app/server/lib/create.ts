import {getElectronLoginSystem} from "app/electron/LoginSystem";
import {
  HostedDocStorageManagerCreator,
  ICreate,
  makeSimpleCreator
} from "app/server/lib/ICreate";
import {DesktopDocStorageManager} from "app/server/lib/DesktopDocStorageManager";

const createDesktopStorageManager: HostedDocStorageManagerCreator =
    async (...args) => new DesktopDocStorageManager(...args);

export const create: ICreate = makeSimpleCreator({
  deploymentType: "electron",
  sessionSecret: "something",
  getLoginSystem: getElectronLoginSystem,
  createHostedDocStorageManager: createDesktopStorageManager,
});

export function getCreator(): ICreate {
  return create;
}

