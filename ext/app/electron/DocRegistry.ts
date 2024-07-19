import * as path from "path";
import { HomeDBManager } from "app/gen-server/lib/homedb/HomeDBManager";
import { fileExists } from "./utils";

export class DocRegistry {

  private idToPathMap: Map<string, string>;
  private pathToIdMap: Map<string, string>;
  private db: HomeDBManager;

  private constructor(dbManager: HomeDBManager) {
    this.db = dbManager;
  }

  public static async create(dbManager: HomeDBManager) {
    // Allocate space.
    const dr = new DocRegistry(dbManager);
    dr.idToPathMap = new Map<string, string>;
    dr.pathToIdMap = new Map<string, string>;

    // Go over all documents we know about.
    for (const doc of await dr.db.getAllDocs()) {
      // All documents are supposed to have externalId set.
      const docPath = doc.options?.externalId;
      if (docPath && fileExists(docPath)) {
        // Cache the two-way mapping docID <-> path.
        dr.idToPathMap.set(doc.id, docPath);
        dr.pathToIdMap.set(docPath, doc.id);
      } else {
        // Remove this document - it should not appear in a DB for Grist Desktop.
        await dr.db.deleteDocument({
          userId: (await dr.getDefaultUser()).id,
          urlId: doc.id
        });
      }
    }
    return dr;
  }

  public lookupById(docId: string): string | null {
    return this.idToPathMap.get(docId) ?? null;
  }

  public lookupByPath(docPath: string): string | null {
    return this.pathToIdMap.get(docPath) ?? null;
  }

  private async getDefaultUser() {
    const user = await this.db.getUserByLogin(process.env.GRIST_DEFAULT_EMAIL as string);
    if (!user) { throw new Error('cannot find default user'); }
    return user;
  }

  public async registerDoc(docPath: string): Promise<string> {
    const defaultUser = await this.getDefaultUser();
    const wss = this.db.unwrapQueryResult(await this.db.getOrgWorkspaces({userId: defaultUser.id}, 0));
    for (const doc of wss[0].docs) {
      if (doc.options?.externalId === docPath) {
        // We might be able to do better.
        throw Error("DocRegistry cache incoherent. Please try restarting the app.");
      }
    }
    const docId = this.db.unwrapQueryResult(await this.db.addDocument({
      userId: defaultUser.id,
    }, wss[0].id, {
      name: path.basename(docPath, '.grist'),
      options: { externalId: docPath },
    }));
    this.pathToIdMap.set(docPath, docId);
    this.idToPathMap.set(docId, docPath);
    return docId;
  }

}
