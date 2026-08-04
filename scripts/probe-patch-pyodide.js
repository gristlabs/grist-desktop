// PROBE ONLY - not for merge.
// pipe.js hands pyodide.loadPackage() absolute paths built with path.join, so
// on windows they look like D:\a\...\sortedcontainers-2.4.0-...whl.
//
// The sandbox child gets a hand-built env (NSandbox.ts), so no flag of ours
// reaches it. Instead: try the paths as-is, then try again as file:// URLs, and
// log both outcomes. On linux the first works and the second is a no-op.

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

const replacement = `    const lsty = (await listLibs(src)).available.map(item => item.fullName);
    this.log("[probe] dir:", src);
    this.log("[probe] count:", String(lsty.length), "first:", String(lsty[0]));
    const attempt = async (label, list) => {
      try {
        await this.pyodide.loadPackage(list, {
          messageCallback: (msg) => this.log("[package]", label, msg),
          errorCallback: (msg) => this.log("[package-error]", label, msg),
        });
        this.log("[probe]", label, "resolved");
      } catch (e) {
        this.log("[probe]", label, "THREW:", String(e));
      }
      try {
        await this.pyodide.runPython("import sortedcontainers");
        this.log("[probe]", label, "import sortedcontainers OK");
      } catch (e) {
        this.log("[probe]", label, "import sortedcontainers FAILED");
      }
    };
    await attempt("as-is", lsty);
    await attempt("file-url", lsty.map(p => require("url").pathToFileURL(p).href));`;

fs.writeFileSync(target, src.replace(needle, replacement));
console.log('patched pipe.js: try paths as-is, then as file urls, log both');
