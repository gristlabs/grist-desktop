// Helpers active when GRIST_DESKTOP_TEST_MODE is set: tolerate Chromium
// switches in argv, and stub native dialogs that would block the renderer.

import * as electron from "electron";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { isAffirmative } from "app/common/gutil";
import log from "app/server/lib/log";

export const IS_TEST_MODE = isAffirmative(process.env.GRIST_DESKTOP_TEST_MODE);

const CHROMIUM_TRAILING_URL = "data:,";

export function installDialogStubs() {
  if (!IS_TEST_MODE) { return; }
  const dialogStubDir = fs.mkdtempSync(path.join(os.tmpdir(), "grist-test-dialog-"));
  electron.app.on("will-quit", () => fs.rmSync(dialogStubDir, {recursive: true, force: true}));
  let counter = 0;
  electron.dialog.showSaveDialog = (async (...args: any[]) => {
    // Caller may pass (options) or (browserWindow, options).
    const opts = (args[0] && 'filters' in args[0]) ? args[0] : args[1];
    const ext = opts?.filters?.[0]?.extensions?.[0] || "grist";
    return {canceled: false, filePath: path.join(dialogStubDir, `test-${++counter}.${ext}`)};
  }) as typeof electron.dialog.showSaveDialog;
  electron.dialog.showOpenDialog = (async () =>
    ({canceled: true, filePaths: []})) as typeof electron.dialog.showOpenDialog;
  electron.dialog.showErrorBox = ((title: string, content: string) => {
    log.warn(`(stubbed dialog) ${title}: ${content}`);
  }) as typeof electron.dialog.showErrorBox;
}

export function filterArgvForCommander(argv: string[]): string[] {
  if (!IS_TEST_MODE) { return argv; }
  return argv.filter(a => !a.startsWith("-") && a !== CHROMIUM_TRAILING_URL);
}
