import * as fse from "fs-extra";
import * as path from "path";

export function fileExists(filePath: string): boolean {
  let ret = true;
  try {
    fse.accessSync(filePath, fse.constants.F_OK);
  } catch {
    ret = false;
  }
  return ret;
}

export function fileCreatable(filePath: string): boolean {
  let ret = true;
  try {
    fse.accessSync(path.dirname(filePath), fse.constants.W_OK);
  } catch {
    ret = false;
  }
  return ret;
}
