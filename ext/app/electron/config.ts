import * as electron from "electron";
import * as fse from "fs-extra";
import * as log from "app/server/lib/log";
import * as net from 'net';
import * as packageJson from "desktop.package.json";
import * as path from "path";
import bluebird from 'bluebird';
import { commonUrls } from "app/common/gristUrls";

const NO_VALIDATION = () => true;


/**
 * Copied from grist-core, since it is unsafe to import core code at this point.
 */
async function getAvailablePort(firstPort: number = 8000, optCount: number = 200): Promise<number> {
  const lastPort = firstPort + optCount - 1;
  async function checkNext(port: number): Promise<number> {
    if (port > lastPort) {
      throw new Error("No available ports between " + firstPort + " and " + lastPort);
    }
    return new bluebird((resolve: (p: number) => void, reject: (e: Error) => void) => {
      const server = net.createServer();
      server.on('error', reject);
      server.on('close', () => resolve(port));
      server.listen(port, 'localhost', () => server.close());
    })
    .catch(() => checkNext(port + 1));
  }
  return bluebird.try(() => checkNext(firstPort));
}

function check(envKey: string, validator: (value: string) => boolean, defaultValue: string,): void {
  const envValue = process.env[envKey];
  if (envValue === undefined) {
    log.warn(`${envKey} is not set, using default value ${defaultValue}`);
      process.env[envKey] = defaultValue;
  } else {
    if (!validator(envValue)) {
      log.warn(`$${envKey} has invalid value ${envValue}, using default value ${defaultValue}`);
      process.env[envKey] = defaultValue;
    }
  }
}


export async function loadConfig() {
  if (process.env.GRIST_ELECTRON_AUTH !== undefined) {
    if (process.env.GRIST_DESKTOP_AUTH === undefined) {
      process.env.GRIST_DESKTOP_AUTH = process.env.GRIST_ELECTRON_AUTH;
      log.warn("GRIST_ELECTRON_AUTH has been deprecated; use GRIST_DESKTOP_AUTH instead.");
    } else {
      log.warn("GRIST_DESKTOP_AUTH set, ignoring GRIST_ELECTRON_AUTH (deprecated).");
    }
  }
  check(
    "GRIST_DEFAULT_USERNAME",
    NO_VALIDATION,
    "You"
  );
  check(
    "GRIST_DEFAULT_EMAIL",
    NO_VALIDATION,
    "you@example.com"
  );
  check(
    "GRIST_HOST",
    NO_VALIDATION,
    "localhost"
  );
  check(
    "GRIST_PORT",
    (portstr) => {
      if (! /^\d+$/.test(portstr)) {
        return false;
      }
      const port = parseInt(portstr);
      return port > 0 && port < 65536;
    },
    (await getAvailablePort(47478)).toString()
  );
  check(
    "GRIST_DESKTOP_AUTH",
    (auth) => ["strict", "none", "mixed"].includes(auth),
    "strict"
  );
  check(
    "GRIST_SANDBOX_FLAVOR",
    (flavor) => ["pyodide", "unsandboxed", "gvisor", "macSandboxExec"].includes(flavor),
    "pyodide"
  );
  check(
    "GRIST_INST_DIR",
    NO_VALIDATION,
    electron.app.getPath("userData")
  );
  check(
    "GRIST_DATA_DIR",
    NO_VALIDATION,
    electron.app.getPath("documents")
  );
  check(
    "GRIST_USER_ROOT",
    NO_VALIDATION,
    path.join(electron.app.getPath("home"), ".grist")
  );
  check(
    "TYPEORM_DATABASE",
    NO_VALIDATION,
    path.join(electron.app.getPath("appData"), "landing.db")
  );
  check(
    "GRIST_WIDGET_LIST_URL", // Related to plugins (Would have to be changed if local custom widgets are used?)
    NO_VALIDATION,
    commonUrls.gristLabsWidgetRepository
  );

  const homeDBLocation = path.parse((process.env.TYPEORM_DATABASE as string)).dir;
  if (!fse.existsSync(homeDBLocation)) {
    log.warn(`Directory to contain the home DB does not exist, creating ${homeDBLocation}`);
    fse.mkdirSync(homeDBLocation);
  }

  // We don't allow manually setting these envvars anymore. Fixing them makes maintaining grist-desktop easier.
  process.env.APP_HOME_URL = `http://${process.env["GRIST_HOST"]}:${process.env["GRIST_PORT"]}`;
  process.env.GRIST_SINGLE_PORT = "true";
  process.env.GRIST_SERVE_SAME_ORIGIN = "true";
  process.env.GRIST_DEFAULT_PRODUCT = "Free";
  process.env.GRIST_ORG_IN_PATH = "true";
  process.env.GRIST_HIDE_UI_ELEMENTS = "helpCenter,billing,templates,multiSite,multiAccounts";
  process.env.GRIST_CONTACT_SUPPORT_URL = packageJson.repository + "/issues";
  if (process.env.GRIST_DESKTOP_AUTH !== "mixed") {
    process.env.GRIST_FORCE_LOGIN = "true";
  }

  // Note: This is neither validated nor documented, and subject to deprecation.
  // Original comment: TODO: check trust in electron scenario, this code is very rusty.
  if (process.env.GRIST_UNTRUSTED_PORT === undefined && process.env.APP_UNTRUSTED_URL === undefined) {
    process.env["GRIST_UNTRUSTED_PORT"] = (await getAvailablePort(47479)).toString();
  }
}
