/**
 * Stopping an app this repo spawned. Shared by the runner and by the tests that
 * start an app themselves, since getting it wrong strands a process holding the
 * state directory open.
 */

const {spawnSync} = require('child_process');
const fs = require('fs');

/**
 * Waits for the app to be gone, not merely signalled: it holds the state
 * directory's sqlite files open, and Windows will not delete those under a live
 * process. Windows also has no process group to kill, so taskkill is told to
 * take the whole tree.
 */
function stopApp(app) {
  return new Promise((resolve) => {
    if (!app.pid || app.exitCode !== null || app.signalCode !== null) { return resolve(); }
    app.once('exit', resolve);
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(app.pid), '/T', '/F']);
    } else {
      app.kill();
      setTimeout(() => app.kill('SIGKILL'), 5000).unref();
    }
    setTimeout(resolve, 10000).unref();
  });
}

/**
 * Removes a directory the app was working in. Windows can keep a document's
 * file open for a moment after the process that held it is gone, so the removal
 * is retried. A directory that still cannot be removed is left behind: these sit
 * under the system temp directory, and cleanup is not what the test is checking.
 */
function removeWorkDir(dir) {
  try {
    fs.rmSync(dir, {recursive: true, force: true, maxRetries: 20, retryDelay: 100});
  } catch (e) {
    console.log(`[left ${dir} behind: ${e.code || e.message}]`);
  }
}

exports.stopApp = stopApp;
exports.removeWorkDir = removeWorkDir;
