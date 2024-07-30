import * as dotenv from "dotenv";
import * as electron from "electron";
import * as fse from "fs-extra";
import * as log from "app/server/lib/log";
import * as packageJson from "ext/desktop.package.json";
import * as path from "path";
import { commonUrls } from "app/common/gristUrls";
import { getAvailablePort } from "app/server/lib/serverUtils";


const NO_VALIDATION = () => true;


function validateOrFallback(envKey: string, validator: (value: string) => boolean, defaultValue: string,): void {
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
  dotenv.config();
  if (process.env.GRIST_ELECTRON_AUTH !== undefined) {
    if (process.env.GRIST_DESKTOP_AUTH === undefined) {
      process.env.GRIST_DESKTOP_AUTH = process.env.GRIST_ELECTRON_AUTH;
      log.warn("GRIST_ELECTRON_AUTH has been deprecated; use GRIST_DESKTOP_AUTH instead.");
    } else {
      log.warn("GRIST_DESKTOP_AUTH set, ignoring GRIST_ELECTRON_AUTH (deprecated).");
    }
  }
  validateOrFallback(
    "GRIST_DEFAULT_USERNAME",
    NO_VALIDATION,
    "You"
  );
  validateOrFallback(
    "GRIST_DEFAULT_EMAIL",
    NO_VALIDATION,
    "you@example.com"
  );
  validateOrFallback(
    "GRIST_HOST",
    NO_VALIDATION,
    "localhost"
  );
  validateOrFallback(
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
  validateOrFallback(
    "GRIST_DESKTOP_AUTH",
    (auth) => ["strict", "none", "mixed"].includes(auth),
    "strict"
  );
  validateOrFallback(
    "GRIST_SANDBOX_FLAVOR",
    (flavor) => ["pyodide", "unsandboxed", "gvisor", "macSandboxExec"].includes(flavor),
    "pyodide"
  );
  validateOrFallback(
    "GRIST_INST_DIR",
    NO_VALIDATION,
    electron.app.getPath("userData")
  );
  validateOrFallback(
    "GRIST_DATA_DIR",
    NO_VALIDATION,
    electron.app.getPath("documents")
  );
  validateOrFallback(
    "GRIST_USER_ROOT",
    NO_VALIDATION,
    path.join(electron.app.getPath("home"), ".grist")
  );
  validateOrFallback(
    "TYPEORM_DATABASE",
    NO_VALIDATION,
    path.join(electron.app.getPath("appData"), "landing.db")
  );
  validateOrFallback(
    "GRIST_WIDGET_LIST_URL", // Related to plugins (Would have to be changed if local custom widgets are used?)
    NO_VALIDATION,
    commonUrls.gristLabsWidgetRepository
  );

  const homeDBLocation = path.parse(path.resolve(process.env.TYPEORM_DATABASE as string)).dir;
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
