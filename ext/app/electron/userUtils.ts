import {HomeDBManager} from "app/gen-server/lib/homedb/HomeDBManager";
import {User} from "app/gen-server/entity/User";

// Having this in its own file enables a consistent implementation, without having files be dependent on
// GristApp.ts for GristApp.instance.getDefaultUser(), which was causing circular imports.
export async function getDefaultUser(homeDB: HomeDBManager): Promise<User | undefined> {
    return homeDB.getUserByLogin(process.env.GRIST_DEFAULT_EMAIL as string);
}
