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
import * as packageJson from "desktop.package.json";
import * as version from "app/common/version";
import { GristApp } from "app/electron/GristApp";
import { loadConfig } from "app/electron/config";

program.name(packageJson.name).version(`${packageJson.productName} ${packageJson.version} (with Grist Core ${version.version})`);
program.parse();

// When unpackaged (yarn electron:preview), the module's name will be argv[1]. 
// This snippet strips that to mimic the behavior when packaged.
// Since commander already handles this gotcha, the hack must be applied after parsing arguments.
if (!electron.app.isPackaged) {
  process.argv.splice(1, 1);
}

loadConfig().then(() => {
  new GristApp().main();
});
