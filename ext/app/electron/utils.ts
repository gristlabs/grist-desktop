import * as fse from "fs-extra";

export function fileExists(filePath: string): boolean {
  let ret = true;
  try {
    fse.accessSync(filePath, fse.constants.F_OK);
  } catch {
    ret = false;
  }
  return ret;
}
