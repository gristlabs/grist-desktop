"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron = __importStar(require("electron"));
const path = __importStar(require("path"));
const commander_1 = require("commander");
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
const corePackageJson = __importStar(require("ext/core.package.json"));
const log_1 = __importDefault(require("app/server/lib/log"));
const packageJson = __importStar(require("ext/desktop.package.json"));
const GristApp_1 = require("app/electron/GristApp");
const config_1 = require("app/electron/config");
const logging_1 = require("./logging");
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
let initialFileToOpen = null;
// macOS-specific event.
// This only handles the situation "when a file is dropped onto the dock and the application is not yet running".
// The other situation is handled separately.
// https://www.electronjs.org/docs/latest/api/app#event-open-file-macos
electron.app.on('open-file', (e, docPath) => {
    e === null || e === void 0 ? void 0 : e.preventDefault(); // Electron requires this. See link above.
    initialFileToOpen = docPath;
});
commander_1.program
    .name(packageJson.name)
    .version(`${packageJson.productName} ${packageJson.version} (with Grist Core ${corePackageJson.version})`)
    // On Windows, opening a file by double-clicking it invokes Grist with path as the first arg.
    .argument("[file]", "File to open, can be Grist document or importable document")
    .action((docPath) => {
    initialFileToOpen = docPath !== null && docPath !== void 0 ? docPath : null;
});
// Commander.js has "node" and "electron" modes, but they don't handle the quirks above well enough.
// Thus, we manually handle CLI arguments Commander doesn't need to see.
// Here, slice to ignore argv[0].
commander_1.program.parse(process.argv.slice(1), { from: "user" });
if (!electron.app.requestSingleInstanceLock({
    // Inform the running instance of the document we want to open, if any.
    fileToOpen: initialFileToOpen
})) {
    log_1.default.warn(`${packageJson.productName} is already running.`);
    // We exit before even launching the Grist server, so no cleanup is needed.
    process.exit(0);
}
(0, config_1.loadConfig)()
    .then(() => {
    (0, logging_1.setupLogging)();
    GristApp_1.GristApp.instance.run(initialFileToOpen);
})
    .catch((err) => {
    log_1.default.error(`Failed to load config, aborting: ${err}`);
    process.exit(1);
});
//# sourceMappingURL=main.js.map