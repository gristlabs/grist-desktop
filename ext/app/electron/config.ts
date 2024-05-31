import * as path from 'path'
import * as fse from 'fs-extra'
import * as electron from 'electron';
import * as ini from 'ini'
import * as os from 'os'
import * as log from 'app/server/lib/log';
import * as packageJson from 'desktop.package.json';
import {commonUrls} from 'app/common/gristUrls';

const CONFIG_DIR = path.join(electron.app.getPath("appData"), packageJson.name)

const APPDATA_DIR = (process.platform == "win32") ? electron.app.getPath("userData"):
  path.join(electron.app.getPath("home"), ".local", "share", packageJson.name)

// Electron's app.getPath("userData") uses productName instead of name
// but productName should be "full capitalized name", not ideal for naming our config directory.
const DEFAULT_CONFIG_FILE = path.join(CONFIG_DIR, "config.ini")
const NO_VALIDATION = () => true

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

type IConfig = {[key: string]: any}

class Config implements IConfig {

  [key: string]: any

  constructor(c: IConfig) {
    Object.assign(this, c)
  }

  /**
   * Apply a configuration item by setting the corresponding environemt variable..
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
    let confValue: any = this
    for (const segment of confKey.split(".")) {
      confValue = confValue[segment]
      if (confValue === undefined) {
        break
      }
    }
    let envValue = process.env[envKey]
    if (envValue === undefined) {
      if (confValue === undefined) {
        log.info(`Neither ${confKey} nor $${envKey} is specified, using default value ${defaultValue}`)
        process.env[envKey] = defaultValue
        return
      } else {
        // envvar is undefined but config has it
        if (!validator(confValue)) {
          log.warn(`${confKey} has invalid value ${confValue}, using default value ${defaultValue}`)
          process.env[envKey] = defaultValue
        } else {
          process.env[envKey] = confValue
        }
      }
    } else {
      // envvar is defined, ignore config
      if (confValue !== undefined) {
        log.warn(`${confKey} is overridden by $${envKey}`)
      }
      if (!validator(envValue)) {
        log.warn(`$${envKey} has invalid value ${envValue}, using default value ${defaultValue}`)
        process.env[envKey] = defaultValue
      }
    }
  }
}


function loadConfigFile(filename: string = DEFAULT_CONFIG_FILE) {
  let config: Config
  try {
    let configBuffer = fse.readFileSync(filename)
    config = new Config(ini.parse(configBuffer.toString("utf8")))
  } catch (err) {
    log.warn(`Failed to read configuration file: ${err}`)
    config = new Config({})
  }
  // Section: login
  config.apply(
    "login.username",
    "GRIST_DEFAULT_USERNAME",
    NO_VALIDATION,
    getUsername()
  )
  config.apply(
    "login.email",
    "GRIST_DEFAULT_EMAIL",
    NO_VALIDATION,
    getEmail()
  )
  // Section: server
  config.apply(
    "server.listen",
    "GRIST_HOST",
    NO_VALIDATION,
    "localhost"
  )
  config.apply(
    "server.port",
    "GRIST_PORT",
    (portstr) => {
      if (! /^\d+$/.test(portstr)) {
        return false
      }
      let port = parseInt(portstr)
      return port > 0 && port < 65536
    },
    "_RANDOM"
  )
  config.apply(
    "server.auth",
    "GRIST_DESKTOP_AUTH",
    (auth) => ["strict", "none", "mixed"].includes(auth),
    "strict"
  )
  // Section: sandbox
  config.apply(
    "sandbox.flavor",
    "GRIST_SANDBOX_FLAVOR",
    (flavor) => ["pyodide", "unsandboxed", "gvisor", "macSandboxExec"].includes(flavor),
    "pyodide"
  )
  // Section: storage
  config.apply(
    "storage.instance",
    "GRIST_INST_DIR",
    NO_VALIDATION,
    APPDATA_DIR
  )
  config.apply(
    "storage.documents",
    "GRIST_DATA_DIR",
    NO_VALIDATION,
    electron.app.getPath("documents")
  )
  config.apply(
    "storage.plugins",
    "GRIST_USER_ROOT",
    NO_VALIDATION,
    path.join(electron.app.getPath("home"), ".grist")
  )
  config.apply(
    "storage.homedb",
    "TYPEORM_DATABASE",
    NO_VALIDATION,
    path.join(APPDATA_DIR, "home.sqlite3")
  )

  const homedb_location = path.parse((process.env.TYPEORM_DATABASE as string)).dir
  if (!fse.existsSync(homedb_location)) {
    log.warn(`Directory to contain the home DB does not exist, creating ${homedb_location}`)
    fse.mkdirSync(homedb_location)
  }

  // We don't allow manually setting these envvars anymore. Fixing them makes maintaining grist-desktop easier.
  process.env.GRIST_SINGLE_PORT = "true"
  process.env.GRIST_SERVE_SAME_ORIGIN = "true"
  process.env.GRIST_DEFAULT_PRODUCT = "Free"
  process.env.GRIST_ORG_IN_PATH = "true";
  process.env.GRIST_HIDE_UI_ELEMENTS = "helpCenter,billing,templates,multiSite,multiAccounts";
  process.env.GRIST_CONTACT_SUPPORT_URL = packageJson.repository + "/issues"
  if (process.env.GRIST_DESKTOP_AUTH !== "mixed") {
    process.env.GRIST_FORCE_LOGIN = "true";
  }

  // Related to plugins (Would have to be changed if local custom widgets are used?)
  suggestEnv("GRIST_WIDGET_LIST_URL", commonUrls.gristLabsWidgetRepository);
}


function getUsername(): string {
  try {
    return os.userInfo().username
  } catch {
    return "You"
  }
}

function getEmail(): string {
  return getUsername().toLowerCase() + "@" + os.hostname()
}

export {loadConfigFile}
