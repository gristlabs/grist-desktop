import log from "app/server/lib/log";
import {getElectronLoginSystem} from "app/electron/LoginSystem";
import {
  BaseCreate,
  ICreate,
} from "app/server/lib/ICreate";
import {DesktopDocStorageManager} from "app/server/lib/DesktopDocStorageManager";
import {HomeDBManager} from "app/gen-server/lib/homedb/HomeDBManager";
import { getDefaultUser } from "app/electron/userUtils";
import { HostedStorageManager } from "app/server/lib/HostedStorageManager";

const createDesktopStorageManager = async (...args: ConstructorParameters<typeof HostedStorageManager>) => {
  const storageManager = new DesktopDocStorageManager(...args);
  const homeDB: HomeDBManager = args[0].getHomeDBManager();
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

class DesktopCreate extends BaseCreate {
  public constructor() {
    super('electron');
  }

  public override getLoginSystem() {
    return getElectronLoginSystem();
  }

  public override createHostedDocStorageManager(...args: ConstructorParameters<typeof HostedStorageManager>) {
    return createDesktopStorageManager(...args);
  }
}

export const create = new DesktopCreate();

export function getCreator(): ICreate {
  return create;
}
