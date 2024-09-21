import * as fse from "fs-extra";
import * as path from "path";

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
