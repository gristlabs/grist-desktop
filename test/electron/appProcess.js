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
    const timers = [];
    app.once('exit', () => { timers.forEach(clearTimeout); resolve(); });
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(app.pid), '/T', '/F']);
    } else {
      app.kill();
      timers.push(setTimeout(() => app.kill('SIGKILL'), 5000));
    }
    // A process that outlives this holds the state directory and the port, so name it here:
    // otherwise it surfaces later as a directory that will not go, or a port already in use.
    timers.push(setTimeout(() => {
      console.warn(`[app ${app.pid} did not exit]`);
      resolve();
    }, 10000));
    timers.forEach(timer => timer.unref());
  });
}

/**
 * Removes a directory the app was working in, with retries: Windows can keep a document's
 * file open for a moment after the process holding it is gone. One that still cannot be
 * removed is left in the system temp directory, rather than failing a test that has passed.
 */
function removeWorkDir(dir) {
  try {
    fs.rmSync(dir, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
  } catch (e) {
    console.warn(`[left ${dir} behind: ${e.code || e.message}]`);
  }
}

exports.stopApp = stopApp;
exports.removeWorkDir = removeWorkDir;
