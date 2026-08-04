// PROBE ONLY - not for merge.
// pipe.js hands pyodide.loadPackage() absolute paths built with path.join. On
// windows those are D:\..., which pyodide parses as a URL and reduces to the
// package name "d:\a\grist" - so all 19 wheels collide and none install, with
// no error thrown. Use file:// URLs instead, and check the result.

const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'core', 'sandbox', 'pyodide', 'pipe.js');
// Windows checks out CRLF, so normalize before matching a multi-line block.
const src = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');

const needle = `    const lsty = (await listLibs(src)).available.map(item => item.fullName);
    await this.pyodide.loadPackage(lsty, {
      messageCallback: (msg) => this.log("[package]", msg),
    });`;

if (!src.includes(needle)) {
  console.error('patch point not found in pipe.js; has loadCode changed?');
  process.exit(1);
}

const replacement = `    const lsty = (await listLibs(src)).available
      .map(item => require("url").pathToFileURL(item.fullName).href);
    this.log("[probe] first:", String(lsty[0]));
    try {
      await this.pyodide.loadPackage(lsty, {
        messageCallback: (msg) => this.log("[package]", msg),
        errorCallback: (msg) => this.log("[package-error]", msg),
      });
      this.log("[probe] loadPackage resolved");
    } catch (e) {
      this.log("[probe] loadPackage THREW:", String(e));
    }
    try {
      await this.pyodide.runPython("import sortedcontainers");
      this.log("[probe] import sortedcontainers OK");
    } catch (e) {
      this.log("[probe] import sortedcontainers FAILED");
    }`;

fs.writeFileSync(target, src.replace(needle, replacement));
console.log('patched pipe.js to load wheels via file:// URLs');
