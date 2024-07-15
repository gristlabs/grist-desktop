import * as electron from "electron";
import * as path from "path";
import { program } from "commander";
// A temporary hack to make `yarn start` work.
// TODO: Create a script that actually calls resolve-tspaths when source code changes, and ditch this.
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
import * as log from "app/server/lib/log";
import * as packageJson from "desktop.package.json";
import * as version from "app/common/version";
import { FileToOpen, GristApp, InstanceHandoverInfo } from "app/electron/GristApp";
import { loadConfig } from "app/electron/config";

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

const fileToOpen = new FileToOpen();

// macOS-specific event.
// https://www.electronjs.org/docs/latest/api/app#event-open-file-macos
electron.app.on('open-file', (e, docPath) => {
  e.preventDefault(); // Electron requires this to handle the open-file event.
  fileToOpen.path = docPath;
});

program
  .name(packageJson.name)
  .version(`${packageJson.productName} ${packageJson.version} (with Grist Core ${version.version})`)
  // On Windows, opening a file by double-clicking it invokes Grist with path as the first arg.
  .argument("[document]", "Grist document to open")
  .action((docPath: string) => {
    fileToOpen.path = docPath;
  });

// Commander.js has "node" and "electron" modes, but they don't handle the quirks above well enough.
// Thus, we manually handle CLI arguments Commander doesn't need to see.
// Here, slice to ignore argv[0].
program.parse(process.argv.slice(1), { from: "user" });

if (!electron.app.requestSingleInstanceLock({
  // Inform the running instance of the document we want to open, if any.
  // DocOpen will resolve the path to absolute.
  fileToOpen: fileToOpen.path
} as InstanceHandoverInfo)) {
  log.warn(`${packageJson.productName} is already running.`);
  // We exit before even launching the Grist server, so no cleanup is needed.
  process.exit(0);
}

loadConfig()
  .then(() => {
    GristApp.instance.run(fileToOpen);
  })
  .catch((err) => {
    log.error(`Failed to load config, aborting: ${err}`);
    process.exit(1);
  });
