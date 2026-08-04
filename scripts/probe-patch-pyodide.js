// PROBE ONLY - not for merge.
//
// Round 5. file:// URLs removed the "Loading same package d:\a\grist" collision
// but the wheels still did not install, and loadPackage still claimed success.
// So the path form was a real defect but not the whole story.
//
// Ask a sharper question: can pyodide load ANY package on windows? sortedcontainers
// ships inside the pyodide distribution, so loading it by name uses pyodide's own
// machinery and none of our paths. If that fails too, the problem is not our wheel
// paths - suspect packageCacheDir (pipe.js:38), another windows path.

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
    this.log("[probe] pyodide version:", String(this.pyodide.version));
    this.log("[probe] cacheDir:", fs.realpathSync(path.join(__dirname, "_build", "cache")));
    const attempt = async (label, arg) => {
      try {
        const r = await this.pyodide.loadPackage(arg, {
          messageCallback: (msg) => this.log("[package]", label, msg),
          errorCallback: (msg) => this.log("[package-error]", label, msg),
        });
        this.log("[probe]", label, "resolved, returned:",
          JSON.stringify(Array.isArray(r) ? r.map(p => p && p.name) : r));
      } catch (e) {
        this.log("[probe]", label, "THREW:", String(e));
      }
      this.log("[probe]", label, "loadedPackages:",
        JSON.stringify(Object.keys(this.pyodide.loadedPackages || {})).slice(0, 300));
      try {
        await this.pyodide.runPython("import sortedcontainers");
        this.log("[probe]", label, "import OK");
      } catch (e) {
        this.log("[probe]", label, "import FAILED");
      }
    };
    // Uses pyodide's own distribution, none of our paths.
    await attempt("by-name", ["sortedcontainers"]);
    // Our wheels, as URLs.
    await attempt("file-url", lsty.map(p => require("url").pathToFileURL(p).href));`;

fs.writeFileSync(target, src.replace(needle, replacement));
console.log('patched pipe.js: try by-name then file-url, report loadedPackages');
