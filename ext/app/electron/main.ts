import * as electron from "electron";
import * as path from "path";
import { program } from "commander";
// HACK: A temporary hack to make `yarn start` work.
if (!electron.app.isPackaged) {
  process.env.NODE_PATH =
    path.resolve(process.cwd(), 'core/_build') +
      ':' +
      path.resolve(process.cwd(), 'core/_build/ext') +
      ':' +
      path.resolve(process.cwd(), 'core/_build/stubs') +
      ':' + process.env.NODE_PATH;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('module').Module._initPaths();
}
// eslint-disable-next-line sort-imports
import * as corePackageJson from "ext/core.package.json";
import * as log from "app/server/lib/log";
import * as packageJson from "ext/desktop.package.json";
import { GristApp } from "app/electron/GristApp";
import { loadConfig } from "app/electron/config";
import { setupLogging } from "./logging";

// Mimic the behavior of a packaged app, where argv will not include "electron" and its arguments.
// Example:
// electron --trace-warnings main.js -> main.js
if (!electron.app.isPackaged) {
  for (let i = 0; i < process.argv.length; i++) {
    if (path.resolve(process.argv[i]) === __filename) {
      process.argv.splice(0, i);
    }
  }
}

// macOS sometimes adds a parameter that looks like "-psn_0_123456". Ignore it.
// This seems to still happen sometimes as of 2019, on macOS 10.14.
// https://phab.getgrist.com/T307
// https://stackoverflow.com/questions/10242115/os-x-strange-psn-command-line-parameter-when-launched-from-finder
if (process.platform === "darwin") {
  for (const [i, arg] of process.argv.entries()) {
    if (arg.startsWith("-psn_")) {
      process.argv.splice(i, 1);
      break;
    }
  }
}

let initialFileToOpen: string|null = null;

// macOS-specific event.
// This only handles the situation "when a file is dropped onto the dock and the application is not yet running".
// The other situation is handled separately.
// https://www.electronjs.org/docs/latest/api/app#event-open-file-macos
electron.app.on('open-file', (e, docPath) => {
  e.preventDefault(); // Electron requires this. See link above.
  initialFileToOpen = docPath;
});

program
  .name(packageJson.name)
  .version(`${packageJson.productName} ${packageJson.version} (with Grist Core ${corePackageJson.version})`)
  // On Windows, opening a file by double-clicking it invokes Grist with path as the first arg.
  .argument("[file]", "File to open, can be Grist document or importable document")
  .action((docPath?: string) => {
    initialFileToOpen = docPath ?? null;
  });

// Commander.js has "node" and "electron" modes, but they don't handle the quirks above well enough.
// Thus, we manually handle CLI arguments Commander doesn't need to see.
// Here, slice to ignore argv[0].
program.parse(process.argv.slice(1), { from: "user" });

if (!electron.app.requestSingleInstanceLock({
  // Inform the running instance of the document we want to open, if any.
  fileToOpen: initialFileToOpen
})) {
  log.warn(`${packageJson.productName} is already running.`);
  // We exit before even launching the Grist server, so no cleanup is needed.
  process.exit(0);
}

loadConfig()
  .then(() => {
    setupLogging();
    GristApp.instance.run(initialFileToOpen);
  })
  .catch((err) => {
    log.error(`Failed to load config, aborting: ${err}`);
    process.exit(1);
  });
