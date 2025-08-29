import * as electron from "electron";
import * as path from "path";
import { Command } from "commander";
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
import { applyPatch } from "app/gen-server/lib/TypeORMPatches";
import log from "app/server/lib/log";
import { getProgram } from "app/server/companion";
import * as packageJson from "ext/desktop.package.json";
import { GristApp } from "app/electron/GristApp";
import { loadConfig } from "app/electron/config";
import { setupLogging } from "./logging";

applyPatch();

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
let exitCode: number|undefined;

// macOS-specific event.
// This only handles the situation "when a file is dropped onto the dock and the application is not yet running".
// The other situation is handled separately.
// https://www.electronjs.org/docs/latest/api/app#event-open-file-macos
electron.app.on('open-file', (e, docPath) => {
  e?.preventDefault(); // Electron requires this. See link above.
  initialFileToOpen = docPath;
});

const electronProgram = new Command();
electronProgram
  .name(packageJson.name)
  .version(`${packageJson.productName} ${packageJson.version} (with Grist Core ${corePackageJson.version})`)
  // On Windows, opening a file by double-clicking it invokes Grist with path as the first arg.
  .option("--cli", "Run in CLI mode instead of opening a file")
  .argument("[file]", "File to open, can be Grist document or importable document")
  .action(async (docPath: string | undefined, options: { cli: boolean }) => {
    if (options.cli) {
      // Somewhere, some electron API may get used that triggers
      // chromium to start up and then fail if there's no display.
      // Turn off all the things that could fail (may be more?)
      electron.app.commandLine.appendSwitch('headless');
      electron.app.commandLine.appendSwitch('disable-gpu');
      electron.app.commandLine.appendSwitch('no-sandbox');
      electron.app.commandLine.appendSwitch('disable-gpu-compositing');
      electron.app.commandLine.appendSwitch('disable-software-rasterizer');
      electron.app.commandLine.appendSwitch('disable-features', 'VizDisplayCompositor');

      const cliIndex = process.argv.indexOf("--cli");
      if (cliIndex === -1) { throw new Error('Cannot find command'); }
      const cliArgs = ['node', 'grist-desktop', ...process.argv.slice(cliIndex + 1)];
      const program2 = getProgram();
      try {
        await program2.parseAsync(cliArgs);
        exitCode = 0;
      } catch (e) {
        exitCode = 1;
        console.error(e);
      }
    }
    initialFileToOpen = docPath ?? null;
  });

async function main() {
  // Commander.js has "node" and "electron" modes, but they don't handle the quirks above well enough.
  // Thus, we manually handle CLI arguments Commander doesn't need to see.
  // Here, slice to ignore argv[0].
  await electronProgram.parseAsync(process.argv.slice(1), { from: "user" });
  if (exitCode) {
    electron.app.exit(exitCode);
  } else if (exitCode === 0) {
    electron.app.quit();
  } else {
    if (!electron.app.requestSingleInstanceLock({
      // Inform the running instance of the document we want to open, if any.
      fileToOpen: initialFileToOpen
    })) {
      log.warn(`${packageJson.productName} is already running.`);
      // We exit before even launching the Grist server, so no cleanup is needed.
      process.exit(0);
    }

    await loadConfig();
    try {
      setupLogging();
      GristApp.instance.run(initialFileToOpen);
    } catch(err) {
      log.error(`Failed to load config, aborting: ${err}`);
      process.exit(1);
    }
  }
}

main();
