import * as log from "app/server/lib/log";
import {getElectronLoginSystem} from "app/electron/LoginSystem";
import {
  HostedDocStorageManagerCreator,
  ICreate,
  makeSimpleCreator
} from "app/server/lib/ICreate";
import {DesktopDocStorageManager} from "app/server/lib/DesktopDocStorageManager";
import {HomeDBManager} from "app/gen-server/lib/homedb/HomeDBManager";
import { getDefaultUser } from "app/electron/userUtils";

const createDesktopStorageManager: HostedDocStorageManagerCreator = async (...args) => {
  const storageManager = new DesktopDocStorageManager(...args);
  const homeDB: HomeDBManager = args[4];
  // Remove any documents from the HomeDB that don't exist on disk. I.e. Sync home DB with filesystem state.
  // It would be better if this used some mechanism built into core,
  // but this is a passable workaround for the moment.
  await storageManager.loadFilePathsFromHomeDB(homeDB);
  const docsWithoutFiles = await storageManager.listDocsWithoutFilesInCache(homeDB);
  const user = await getDefaultUser(homeDB);
  // Can't do anything without a user (which shouldn't happen!), move on without synchronising.
  if (!user) {
    return storageManager;
  }
  const deletions = docsWithoutFiles.map((doc) =>
      homeDB.deleteDocument({
        userId: user.id,
        urlId: doc.id,
      })
      .catch((err) => {
        log.warn(`Failed to remove document ${doc.id} (${doc.name}) when synchronising DB and filesystem. ${err}`);
      })
  );
  // Not many sensible things we can do on failure, other than log.
  await Promise.allSettled(deletions);
  return storageManager;
};

export const create: ICreate = makeSimpleCreator({
  deploymentType: "electron",
  sessionSecret: "no-longer-needed",
  getLoginSystem: getElectronLoginSystem,
  createHostedDocStorageManager: createDesktopStorageManager,
});

export function getCreator(): ICreate {
  return create;
}

