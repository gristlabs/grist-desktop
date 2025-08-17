import * as fse from "fs-extra";
import * as path from "path";
import * as electron from "electron";
import * as log from "app/server/lib/log";

export function fileExists(filePath: string): boolean {
  try {
    fse.accessSync(filePath, fse.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function fileCreatable(filePath: string): boolean {
  try {
    fse.accessSync(path.dirname(filePath), fse.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Load user custom CSS file from ~/.grist/custom.css
 * @returns Object with CSS content and path if file exists, or null if not found
 */
export async function loadCustomCss(): Promise<{cssContent: string, cssPath: string} | null> {
  const customCssPath = path.join(electron.app.getPath("home"), ".grist", "custom.css");
  
  try {
    const cssContent = await fse.readFile(customCssPath, "utf8");
    log.debug(`Loaded custom CSS from ${customCssPath}`);
    return { cssContent, cssPath: customCssPath };
  } catch (err) {
    if (err.code !== "ENOENT") {
      // Only log if it's not a simple "file not found" error
      log.warn(`Failed to read custom CSS: ${err}`);
    }
    return null;
  }
}
