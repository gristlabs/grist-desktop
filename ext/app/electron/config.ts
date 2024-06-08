import * as electron from "electron";
import * as fse from "fs-extra";
import * as ini from "ini";
import * as log from "app/server/lib/log";
import * as net from 'net';
import * as os from "os";
import * as packageJson from "desktop.package.json";
import * as path from "path";
import bluebird from 'bluebird';
import { commonUrls } from "app/common/gristUrls";

const CONFIG_DIR = path.join(electron.app.getPath("appData"), packageJson.name);

const APPDATA_DIR = (process.platform === "win32") ? electron.app.getPath("userData") :
  path.join(electron.app.getPath("home"), ".local", "share", packageJson.name);

// Electron's app.getPath("userData") uses productName instead of name
// but productName should be "full capitalized name", not ideal for naming our config directory.
const DEFAULT_CONFIG_FILE = path.join(CONFIG_DIR, "config.ini");
const NO_VALIDATION = () => true;

/**
 * Suggest a value for an environment variable. If the variable is already set, do nothing. Otherwise set the value.
 * @param name The name of the environment variable.
 * @param value The value to suggest.
 */
function suggestEnv(name: string, value: string): void {
  if (process.env[name] === undefined) {
    process.env[name] = value;
  }
}

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

// The ini library recognizes boolean values, but not numbers. All other values are treated as strings.
type INI = { [key: string]: (INI | string | boolean) }

class Config {

  #config: INI;

  constructor(c: INI) {
    this.#config = c;
  }

  /**
   * Apply a configuration item by setting the corresponding environment variable.
   * The envvar, if already specified, has higher precedence over the config file.
   *
   * @param confKey The corresponding key in the config file.
   * @param envKey The corresponding environment variable name.
   * @param validator A predicate returning true if and only if the value to be used is valid. 
   * @param defaultValue A default value to use when neither the environment variable nor the config file specifies a value, or when validation fails.
   */
  public apply(
    confKey: string,
    envKey: string,
    validator: (value: string) => boolean,
    defaultValue: string,
  ): void {
    let confValue: INI[keyof INI] = this.#config;
    for (const segment of confKey.split(".")) {
      confValue = (confValue as INI)[segment];
      if (confValue === undefined) {
        break;
      }
    }
    const envValue = process.env[envKey];
    if (envValue === undefined) {
      if (confValue === undefined) {
        log.info(`Neither ${confKey} nor $${envKey} is specified, using default value ${defaultValue}`);
        process.env[envKey] = defaultValue;
        return;
      } else {
        // envvar is undefined but config has it
        if (!["string", "boolean"].includes(typeof confValue) || !validator(confValue.toString())) {
          log.warn(`${confKey} has invalid value ${confValue}, using default value ${defaultValue}`);
          process.env[envKey] = defaultValue;
        } else {
          process.env[envKey] = confValue.toString();
        }
      }
    } else {
      // envvar is defined, ignore config
      if (confValue !== undefined) {
        log.warn(`${confKey} is overridden by $${envKey}`);
      }
      if (!validator(envValue)) {
        log.warn(`$${envKey} has invalid value ${envValue}, using default value ${defaultValue}`);
        process.env[envKey] = defaultValue;
      }
    }
  }
}


export async function loadConfig(filename: string = DEFAULT_CONFIG_FILE) {
  let config: Config;
  try {
    const configBuffer = fse.readFileSync(filename);
    config = new Config(ini.parse(configBuffer.toString("utf8")));
  } catch (err) {
    log.warn(`Failed to read configuration file: ${err}`);
    config = new Config({});
  }
  // Section: login
  config.apply(
    "login.username",
    "GRIST_DEFAULT_USERNAME",
    NO_VALIDATION,
    getUsername()
  );
  config.apply(
    "login.email",
    "GRIST_DEFAULT_EMAIL",
    NO_VALIDATION,
    getEmail()
  );
  // Section: server
  config.apply(
    "server.listen",
    "GRIST_HOST",
    NO_VALIDATION,
    "localhost"
  );
  config.apply(
    "server.port",
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
  config.apply(
    "server.auth",
    "GRIST_DESKTOP_AUTH",
    (auth) => ["strict", "none", "mixed"].includes(auth),
    "strict"
  );
  // Section: sandbox
  config.apply(
    "sandbox.flavor",
    "GRIST_SANDBOX_FLAVOR",
    (flavor) => ["pyodide", "unsandboxed", "gvisor", "macSandboxExec"].includes(flavor),
    "pyodide"
  );
  // Section: storage
  config.apply(
    "storage.instance",
    "GRIST_INST_DIR",
    NO_VALIDATION,
    APPDATA_DIR
  );
  config.apply(
    "storage.documents",
    "GRIST_DATA_DIR",
    NO_VALIDATION,
    electron.app.getPath("documents")
  );
  config.apply(
    "storage.plugins",
    "GRIST_USER_ROOT",
    NO_VALIDATION,
    path.join(electron.app.getPath("home"), ".grist")
  );
  config.apply(
    "storage.homedb",
    "TYPEORM_DATABASE",
    NO_VALIDATION,
    path.join(APPDATA_DIR, "home.sqlite3")
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

  // Related to plugins (Would have to be changed if local custom widgets are used?)
  suggestEnv("GRIST_WIDGET_LIST_URL", commonUrls.gristLabsWidgetRepository);

  // Note: This is neither validated nor documented, and subject to deprecation.
  // Original comment: TODO: check trust in electron scenario, this code is very rusty.
  if (process.env.GRIST_UNTRUSTED_PORT === undefined && process.env.APP_UNTRUSTED_URL === undefined) {
    process.env["GRIST_UNTRUSTED_PORT"] = (await getAvailablePort(47479)).toString();
  }
}


function getUsername(): string {
  try {
    return os.userInfo().username;
  } catch {
    return "You";
  }
}

function getEmail(): string {
  return getUsername().toLowerCase() + "@" + os.hostname();
}
