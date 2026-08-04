// PROBE ONLY - not for merge.
//
// Candidate fix. pyodide derives a wheel's package name from the last
// "/"-separated segment, then everything before the first "-". On windows the
// backslashes are not separators to it, so the whole path is the "segment" and
// every wheel collapses to one name: for D:\a\grist-desktop\... that name is
// "d:\a\grist". Eighteen of nineteen are then discarded as duplicates and
// nothing installs, with loadPackage still reporting success.
//
// Forward slashes parse correctly, and windows accepts them for file access.
//
// Takes an optional path to pipe.js, so the same fix can be tried against an
// unpacked release as well as the source tree.

const fs = require('fs');
const path = require('path');

const target = process.argv[2] ||
  path.join(__dirname, '..', 'core', 'sandbox', 'pyodide', 'pipe.js');
// Windows checks out CRLF, so normalize before matching.
const src = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');

const needle = '    const lsty = (await listLibs(src)).available.map(item => item.fullName);';
if (!src.includes(needle)) {
  console.error(`patch point not found in ${target}`);
  process.exit(1);
}

const replacement =
  '    const lsty = (await listLibs(src)).available\n' +
  "      .map(item => item.fullName.split(path.sep).join('/'));\n" +
  '    this.log("[probe] first:", String(lsty[0]));';

fs.writeFileSync(target, src.replace(needle, replacement));
console.log(`patched ${target}: forward slashes for pyodide`);
