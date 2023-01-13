import {addPath} from 'app-module-path';
import log from 'app/server/lib/log';
import {main as mergedServerMain} from 'app/server/mergedServerMain';
import {getAvailablePort} from "app/server/lib/serverUtils";
import * as path from 'path';

if (require.main === module) {
  addPath(path.dirname(path.dirname(__dirname)));
  process.env.APP_ROOT_PATH = path.dirname(path.dirname(__dirname));
}

/**
 * Dev and test entrypoint for single-user Grist server.
 */
export async function main() {
  const port = parseInt(process.env.PORT || '8080', 10);
  if (!process.env.APP_UNTRUSTED_URL) {
    const untrustedPort = await getAvailablePort(47478);
    process.env.APP_UNTRUSTED_URL = `http://localhost:${untrustedPort}`;
  }
  return await mergedServerMain(port, ['home', 'docs', 'static', 'app']);
}

/**
 * Start the server for electron. All options arguments are required.
 * @param options.appRoot: Directory containing Grist code, including subdirectories such
 *    as sandbox, static, and bower_components.
 * @param options.docsRoot: Directory for the user's documents.
 * @param options.userRoot: Directory for addition per user's specific files.
 * @param options.instanceRoot: Path to Grist instance config root; config.json,
 *    grist.db, and grist-sessions.db will be created in this directory.
 * @param options.host: Network interface or hostname to use when starting the server.
 * @param options.port: Port on which to start the server.
 * @param options.untrustedContent: Url on which to start the server for untrusted content.
 * @param options.serverMode: Whether this is electron, server, or dev version.
 */
export async function start(options: {
  appRoot: string,
  userRoot: string,
  docsRoot: string,
  instanceRoot: string,
  host: string,
  port: string|number,
  untrustedContent: string,
  serverMode: string
}) {
  if (options.serverMode !== 'electron') {
    throw new Error('this entry point is only supported for electron now');
  }
  process.env.GRIST_USER_ROOT = options.userRoot;
  process.env.GRIST_DATA_DIR = options.docsRoot;
  process.env.GRIST_INST_DIR = options.instanceRoot;
  process.env.GRIST_HOST = options.host;
  process.env.PORT = String(options.port);
  process.env.APP_UNTRUSTED_URL = options.untrustedContent;
  const server = await main();
  return server.electronServerMethods;
}


if (require.main === module) {
  main().catch((e) => {
    log.error("Grist failed to start", e);
    process.exit(1);
  });
}
