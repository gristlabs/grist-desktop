import * as log from "app/server/lib/log";
import * as path from "path";
import { HomeDBManager } from "app/gen-server/lib/homedb/HomeDBManager";
import { fileExists } from "app/electron/fileUtils";

export class DocRegistry {

  private idToPathMap: Map<string, string>;
  private pathToIdMap: Map<string, string>;
  private db: HomeDBManager;

  // Always use create() to create a new DocRegistry.
  private constructor() {}

  public static async create(dbManager: HomeDBManager) {
    // Allocate space.
    const dr = new DocRegistry();
    dr.db = dbManager;
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

  /**
  * Look for the given path in the registry. If the path has already been assigned a doc ID beforehand, return
  * this ID. Otherwise assign a new doc ID and return it.
  * @param docPath Path to the document.
  * @returns A Promise that resolves to either an existing doc ID or the newly assigned doc ID.
  */
  public async lookupByPathOrCreate(docPath: string): Promise<string> {
    let docId = this.lookupByPath(docPath);
    if (docId === null) {
      // Assign a doc ID if it does not already have one.
      docId = await this.registerDoc(docPath);
      log.debug(`Document ${docPath} not found in home DB, assigned doc ID ${docId}`);
    } else {
      log.debug(`Got known doc ID ${docId} for ${docPath}`);
    }
    return docId;
  }

  public async getDefaultUser() {
    const user = await this.db.getUserByLogin(process.env.GRIST_DEFAULT_EMAIL as string);
    if (!user) { throw new Error('cannot find default user'); }
    return user;
  }

  /**
  * Register a document in the home DB and DocRegistry cache, assigning it a new doc ID.
  * @param docPath Path to the document to register. Must not correspond to a known document in the home DB.
  * @returns A Promise that resolves to the newly assigned doc ID.
  */
  public async registerDoc(docPath: string): Promise<string> {
    const defaultUser = await this.getDefaultUser();
    const wss = this.db.unwrapQueryResult(await this.db.getOrgWorkspaces({userId: defaultUser.id}, 0));
    for (const doc of wss[0].docs) {
      if (doc.options?.externalId === docPath) {
        // We might be able to do better.
        throw Error("DocRegistry cache incoherent. Please try restarting the app.");
      }
    }
    // Create the entry in the home database.
    const docId = this.db.unwrapQueryResult(await this.db.addDocument({
      userId: defaultUser.id,
    }, wss[0].id, {
      name: path.basename(docPath, '.grist'),
      options: { externalId: docPath },
    }));
    // Update the in-memory cache.
    this.pathToIdMap.set(docPath, docId);
    this.idToPathMap.set(docId, docPath);
    return docId;
  }

}
