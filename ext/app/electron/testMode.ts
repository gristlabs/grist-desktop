// Helpers active when GRIST_DESKTOP_TEST_MODE is set: tolerate Chromium
// switches in argv, stub native dialogs that would block the renderer, and
// stand in for the desktop when it hands us a file to open.

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

/** The moments at which the desktop can hand a file over. */
export type TestOpenFileWhen = "before-parse" | "during-startup";

/**
 * Raises "open-file" for the file named in GRIST_DESKTOP_TEST_OPEN_FILE, if the
 * caller is at the point named in GRIST_DESKTOP_TEST_OPEN_FILE_WHEN. macOS
 * passes a file this way instead of in argv, and Finder and the dock cannot be
 * driven from a test, so the event is raised here instead. That leaves only the
 * delivery untested.
 */
export function testEmitOpenFile(when: TestOpenFileWhen) {
  if (!IS_TEST_MODE) { return; }
  const filePath = process.env.GRIST_DESKTOP_TEST_OPEN_FILE;
  if (!filePath || process.env.GRIST_DESKTOP_TEST_OPEN_FILE_WHEN !== when) { return; }
  log.warn(`(test) raising open-file for ${filePath}, ${when}`);
  electron.app.emit("open-file", {preventDefault: () => undefined}, filePath);
}
